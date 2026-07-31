use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use inkjet::constants::HIGHLIGHT_NAMES;
use inkjet::tree_sitter_highlight::HighlightEvent;
use inkjet::{Highlighter, Language};
use serde::Serialize;
use serde_json::Value;
use sha1::{Digest, Sha1};

const MAX_CODE_UTF16_UNITS: usize = 100_000;
const MAX_CODE_LINES: usize = 1_500;
const CACHE_MAX_ENTRIES: usize = 512;
const CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum HighlightOutcome {
    Highlighted {
        language: String,
        html: String,
    },
    Skipped {
        skipped: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
    },
    Unsupported {
        unsupported: bool,
        language: String,
    },
    Unavailable {
        unavailable: bool,
    },
}

#[derive(Default)]
pub struct HighlightRuntime {
    cache: Mutex<HighlightCache>,
    unavailable_logged: AtomicBool,
}

#[derive(Default)]
struct HighlightCache {
    entries: HashMap<String, HighlightOutcome>,
    order: VecDeque<String>,
    bytes: usize,
}

impl HighlightRuntime {
    pub fn highlight(&self, code: &Value, language: &Value) -> HighlightOutcome {
        let text = code.as_str().unwrap_or_default();
        let normalized = normalize_language(language.as_str().unwrap_or_default());
        if text.is_empty() || normalized.is_empty() {
            return HighlightOutcome::Skipped {
                skipped: true,
                language: (!normalized.is_empty()).then_some(normalized),
            };
        }
        if matches!(normalized.as_str(), "text" | "plaintext")
            || text.encode_utf16().count() > MAX_CODE_UTF16_UNITS
            || text.bytes().filter(|byte| *byte == b'\n').count() + 1 > MAX_CODE_LINES
        {
            return HighlightOutcome::Skipped {
                skipped: true,
                language: Some(normalized),
            };
        }

        let cache_key = highlight_cache_key(&normalized, text);
        if let Some(cached) = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&cache_key)
        {
            return cached;
        }

        let outcome = match highlight_html(&normalized, text) {
            Ok(Some(html)) => HighlightOutcome::Highlighted {
                language: normalized,
                html,
            },
            Ok(None) => HighlightOutcome::Unsupported {
                unsupported: true,
                language: normalized,
            },
            Err(error) => {
                if !self.unavailable_logged.swap(true, Ordering::AcqRel) {
                    tracing::warn!(%error, "native syntax highlighting unavailable");
                }
                return HighlightOutcome::Unavailable { unavailable: true };
            }
        };
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(cache_key, outcome.clone());
        outcome
    }
}

impl HighlightCache {
    fn get(&mut self, key: &str) -> Option<HighlightOutcome> {
        let value = self.entries.get(key)?.clone();
        if let Some(index) = self.order.iter().position(|candidate| candidate == key) {
            self.order.remove(index);
        }
        self.order.push_back(key.to_string());
        Some(value)
    }

    fn insert(&mut self, key: String, value: HighlightOutcome) {
        let size = key.len() + outcome_size(&value);
        if size > CACHE_MAX_BYTES {
            return;
        }
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self
                .bytes
                .saturating_sub(key.len() + outcome_size(&previous));
            if let Some(index) = self.order.iter().position(|candidate| candidate == &key) {
                self.order.remove(index);
            }
        }
        self.bytes += size;
        self.order.push_back(key.clone());
        self.entries.insert(key, value);
        while self.entries.len() > CACHE_MAX_ENTRIES || self.bytes > CACHE_MAX_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self
                    .bytes
                    .saturating_sub(oldest.len() + outcome_size(&removed));
            }
        }
    }
}

fn highlight_html(language: &str, source: &str) -> Result<Option<String>, inkjet::InkjetError> {
    if language == "ansi" {
        return Ok(Some(highlight_ansi(source)));
    }
    if matches!(language, "markdown" | "md" | "mdx") {
        return Ok(Some(highlight_markdown(source)));
    }
    let engine_language = approximate_language(language).or_else(|| Language::from_token(language));
    let Some(engine_language) = engine_language else {
        return Ok(None);
    };
    let mut highlighter = Highlighter::new();
    let events = highlighter.highlight_raw(engine_language, &source)?;
    let mut renderer = LineRenderer::default();
    let mut color_stack = Vec::<Option<&'static str>>::new();
    for event in events {
        match event? {
            HighlightEvent::Source { start, end } => {
                let color = color_stack.iter().rev().find_map(|color| *color);
                if let Some(text) = source.get(start..end) {
                    if let Some(color) = color {
                        renderer.write(text, Some(color));
                    } else {
                        renderer.write_lexed(text, language);
                    }
                }
            }
            HighlightEvent::HighlightStart(index) => {
                color_stack.push(
                    HIGHLIGHT_NAMES
                        .get(index.0)
                        .and_then(|name| color_for_scope(name)),
                );
            }
            HighlightEvent::HighlightEnd => {
                color_stack.pop();
            }
        }
    }
    Ok(Some(renderer.finish()))
}

fn approximate_language(language: &str) -> Option<Language> {
    match language {
        "xml" | "vue" | "astro" => Some(Language::Html),
        "plist" => Some(Language::Html),
        "dotenv" => Some(Language::Bash),
        "gitignore" | "ignore" => Some(Language::Plaintext),
        _ => None,
    }
}

fn normalize_language(language: &str) -> String {
    let lowercased = language.trim().to_lowercase();
    let normalized = lowercased
        .strip_prefix("language-")
        .unwrap_or(&lowercased)
        .to_string();
    match normalized.as_str() {
        "mjs" | "cjs" => "javascript".into(),
        "cts" | "mts" => "typescript".into(),
        "golang" => "go".into(),
        "htm" | "xhtml" => "html".into(),
        "svg" => "xml".into(),
        "shell" | "shellscript" => "bash".into(),
        "plain" | "txt" => "text".into(),
        "h" => "c".into(),
        _ => normalized,
    }
}

fn color_for_scope(scope: &str) -> Option<&'static str> {
    let root = scope.split('.').next().unwrap_or(scope);
    match root {
        "comment" => Some("--sh-token-comment"),
        "constant" => Some("--sh-token-constant"),
        "string" | "escape" | "markup" if scope.contains("raw") => Some("--sh-token-string"),
        "string" => Some("--sh-token-string"),
        "variable" | "attribute" | "label" => Some("--sh-token-parameter"),
        "punctuation" => Some("--sh-token-punctuation"),
        "keyword" | "operator" | "type" | "constructor" | "tag" | "namespace" => {
            Some("--sh-token-keyword")
        }
        "function" => Some("--sh-token-function"),
        "diff" if scope.contains("plus") => Some("--sh-token-inserted"),
        "diff" if scope.contains("minus") => Some("--sh-token-deleted"),
        "diff" => Some("--sh-token-changed"),
        "markup" if scope.contains("link") => Some("--sh-token-link"),
        _ => None,
    }
}

#[derive(Default)]
struct LineRenderer {
    html: String,
    line_open: bool,
}

impl LineRenderer {
    fn write(&mut self, text: &str, color: Option<&str>) {
        let mut parts = text.split('\n').peekable();
        while let Some(part) = parts.next() {
            self.ensure_line();
            if !part.is_empty() {
                if let Some(color) = color {
                    self.html.push_str("<span style=\"color:var(");
                    self.html.push_str(color);
                    self.html.push_str(")\">");
                    push_escaped(&mut self.html, part);
                    self.html.push_str("</span>");
                } else {
                    push_escaped(&mut self.html, part);
                }
            }
            if parts.peek().is_some() {
                self.close_line();
                self.html.push('\n');
            }
        }
    }

    fn write_lexed(&mut self, text: &str, language: &str) {
        let bytes = text.as_bytes();
        let mut index = 0;
        let mut plain_start = 0;
        while index < bytes.len() {
            let token = if bytes[index..].starts_with(b"//") {
                Some((
                    bytes[index..]
                        .iter()
                        .position(|byte| *byte == b'\n')
                        .map_or(bytes.len(), |end| index + end),
                    "--sh-token-comment",
                ))
            } else if hash_starts_comment(language, text, index) {
                Some((
                    bytes[index..]
                        .iter()
                        .position(|byte| *byte == b'\n')
                        .map_or(bytes.len(), |end| index + end),
                    "--sh-token-comment",
                ))
            } else if matches!(bytes[index], b'\"' | b'\'' | b'`') {
                let quote = bytes[index];
                let mut end = index + 1;
                while end < bytes.len() {
                    if bytes[end] == b'\\' {
                        end = (end + 2).min(bytes.len());
                    } else if bytes[end] == quote {
                        end += 1;
                        break;
                    } else {
                        end += 1;
                    }
                }
                Some((end, "--sh-token-string"))
            } else if bytes[index].is_ascii_digit() {
                let mut end = index + 1;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric()
                        || matches!(bytes[end], b'.' | b'_' | b'x' | b'o' | b'b'))
                {
                    end += 1;
                }
                Some((end, "--sh-token-constant"))
            } else if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
                let mut end = index + 1;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                {
                    end += 1;
                }
                lexical_word_color(&text[index..end])
                    .or_else(|| {
                        text[end..]
                            .trim_start()
                            .starts_with('(')
                            .then_some("--sh-token-function")
                    })
                    .map(|color| (end, color))
            } else if bytes[index].is_ascii_punctuation() {
                Some((index + 1, "--sh-token-punctuation"))
            } else {
                None
            };

            let Some((end, color)) = token else {
                index += text[index..]
                    .chars()
                    .next()
                    .map(char::len_utf8)
                    .unwrap_or(1);
                continue;
            };
            if plain_start < index {
                self.write(&text[plain_start..index], None);
            }
            self.write(&text[index..end], Some(color));
            index = end;
            plain_start = end;
        }
        if plain_start < text.len() {
            self.write(&text[plain_start..], None);
        }
    }

    fn ensure_line(&mut self) {
        if !self.line_open {
            self.html.push_str("<span class=\"line\">");
            self.line_open = true;
        }
    }

    fn close_line(&mut self) {
        if self.line_open {
            self.html.push_str("</span>");
            self.line_open = false;
        }
    }

    fn finish(mut self) -> String {
        self.ensure_line();
        self.close_line();
        self.html
    }
}

fn lexical_word_color(word: &str) -> Option<&'static str> {
    match word {
        "true" | "false" | "null" | "nil" | "None" => Some("--sh-token-constant"),
        "fn" | "func" | "function" => Some("--sh-token-function"),
        "abstract" | "as" | "async" | "await" | "break" | "case" | "catch" | "class" | "const"
        | "continue" | "default" | "defer" | "do" | "else" | "enum" | "export" | "extends"
        | "final" | "for" | "from" | "if" | "impl" | "import" | "in" | "interface" | "let"
        | "loop" | "match" | "mod" | "mut" | "namespace" | "new" | "override" | "private"
        | "protected" | "pub" | "public" | "readonly" | "return" | "static" | "struct"
        | "switch" | "throw" | "trait" | "try" | "type" | "use" | "var" | "while" | "yield" => {
            Some("--sh-token-keyword")
        }
        _ => None,
    }
}

fn hash_starts_comment(language: &str, text: &str, index: usize) -> bool {
    if text.as_bytes()[index] != b'#'
        || !matches!(
            language,
            "bash" | "sh" | "shell" | "python" | "py" | "ruby" | "rb" | "yaml" | "yml"
        )
    {
        return false;
    }
    text[..index]
        .rsplit_once('\n')
        .map_or(index == 0, |(_, line)| {
            line.chars().all(char::is_whitespace)
        })
}

fn highlight_markdown(source: &str) -> String {
    let mut renderer = LineRenderer::default();
    let mut lines = source.split('\n').peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim_start();
        let indentation = line.len() - trimmed.len();
        if indentation > 0 {
            renderer.write(&line[..indentation], None);
        }
        let heading_length = trimmed
            .bytes()
            .take_while(|byte| *byte == b'#')
            .count()
            .min(6);
        if heading_length > 0
            && trimmed
                .as_bytes()
                .get(heading_length)
                .is_some_and(u8::is_ascii_whitespace)
        {
            renderer.write(
                &trimmed[..heading_length + 1],
                Some("--sh-token-punctuation"),
            );
            renderer.write(&trimmed[heading_length + 1..], Some("--sh-token-function"));
        } else if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            renderer.write(trimmed, Some("--sh-token-punctuation"));
        } else if trimmed.starts_with("- ")
            || trimmed.starts_with("* ")
            || trimmed.starts_with("+ ")
        {
            renderer.write(&trimmed[..2], Some("--sh-token-punctuation"));
            highlight_markdown_inline(&mut renderer, &trimmed[2..]);
        } else {
            highlight_markdown_inline(&mut renderer, trimmed);
        }
        if lines.peek().is_some() {
            renderer.write("\n", None);
        }
    }
    renderer.finish()
}

fn highlight_markdown_inline(renderer: &mut LineRenderer, line: &str) {
    let mut offset = 0;
    while let Some(start) = line[offset..].find('`').map(|index| offset + index) {
        if start > offset {
            renderer.write(&line[offset..start], None);
        }
        let Some(end) = line[start + 1..].find('`').map(|index| start + 1 + index) else {
            renderer.write(&line[start..], None);
            return;
        };
        renderer.write(&line[start..=end], Some("--sh-token-string"));
        offset = end + 1;
    }
    if offset < line.len() {
        renderer.write(&line[offset..], None);
    }
}

fn highlight_ansi(source: &str) -> String {
    let mut renderer = LineRenderer::default();
    let mut color = None;
    let mut offset = 0;
    while let Some(relative) = source[offset..].find('\u{1b}') {
        let start = offset + relative;
        renderer.write(&source[offset..start], color);
        let remaining = &source[start..];
        let Some(parameters_start) = remaining.strip_prefix("\u{1b}[") else {
            renderer.write("\u{1b}", color);
            offset = start + 1;
            continue;
        };
        let Some(final_offset) =
            parameters_start.find(|character: char| character.is_ascii_alphabetic())
        else {
            renderer.write(remaining, color);
            return renderer.finish();
        };
        let final_character = parameters_start.as_bytes()[final_offset] as char;
        if final_character == 'm' {
            color = ansi_color(&parameters_start[..final_offset], color);
        }
        offset = start + 2 + final_offset + 1;
    }
    renderer.write(&source[offset..], color);
    renderer.finish()
}

fn ansi_color(parameters: &str, current: Option<&'static str>) -> Option<&'static str> {
    let mut color = current;
    for parameter in parameters.split(';').filter_map(|value| {
        if value.is_empty() {
            Some(0)
        } else {
            value.parse::<u16>().ok()
        }
    }) {
        color = match parameter {
            0 | 39 => None,
            30 => Some("--sh-ansi-black"),
            31 => Some("--sh-ansi-red"),
            32 => Some("--sh-ansi-green"),
            33 => Some("--sh-ansi-yellow"),
            34 => Some("--sh-ansi-blue"),
            35 => Some("--sh-ansi-magenta"),
            36 => Some("--sh-ansi-cyan"),
            37 => Some("--sh-ansi-white"),
            90 => Some("--sh-ansi-bright-black"),
            91 => Some("--sh-ansi-bright-red"),
            92 => Some("--sh-ansi-bright-green"),
            93 => Some("--sh-ansi-bright-yellow"),
            94 => Some("--sh-ansi-bright-blue"),
            95 => Some("--sh-ansi-bright-magenta"),
            96 => Some("--sh-ansi-bright-cyan"),
            97 => Some("--sh-ansi-bright-white"),
            _ => color,
        };
    }
    color
}

fn push_escaped(output: &mut String, text: &str) {
    for character in text.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
}

fn highlight_cache_key(language: &str, source: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(language.as_bytes());
    hasher.update([0]);
    hasher.update(source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn outcome_size(outcome: &HighlightOutcome) -> usize {
    serde_json::to_vec(outcome)
        .map(|encoded| encoded.len())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_highlight_fixture_uses_the_browser_and_swift_span_contract() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../apps/apple/Fixtures/highlight_response.json"
        ))
        .expect("highlight fixture");
        let html = fixture["html"].as_str().expect("highlight HTML");
        assert_constrained_html(html);
        assert_eq!(
            decode_highlight_text(html),
            "const answer = \"<&\";\nprint(answer)"
        );
    }

    #[test]
    fn normalizes_shiki_aliases_and_skips_bounded_inputs() {
        assert_eq!(normalize_language(" language-MTS "), "typescript");
        assert_eq!(normalize_language("svg"), "xml");
        assert!(matches!(
            HighlightRuntime::default().highlight(&Value::String("hello".into()), &Value::String("txt".into())),
            HighlightOutcome::Skipped { language: Some(language), .. } if language == "text"
        ));
        assert!(matches!(
            HighlightRuntime::default().highlight(
                &Value::String("x".repeat(MAX_CODE_UTF16_UNITS + 1)),
                &Value::String("rust".into())
            ),
            HighlightOutcome::Skipped { .. }
        ));
    }

    #[test]
    fn typescript_highlight_is_constrained_and_round_trips_text() {
        let source = "const value: number = 42;\nconsole.log(\"<&\");";
        let outcome = HighlightRuntime::default().highlight(
            &Value::String(source.into()),
            &Value::String("typescript".into()),
        );
        let HighlightOutcome::Highlighted { language, html } = outcome else {
            panic!("expected highlighted output");
        };
        assert_eq!(language, "typescript");
        assert!(html.contains("<span class=\"line\">"));
        assert!(html.contains("color:var(--sh-token-keyword)"));
        assert!(!html.contains("<script"));
        assert_eq!(decode_highlight_text(&html), source);
        assert_constrained_html(&html);
    }

    #[test]
    fn markdown_and_ansi_use_safe_css_variables() {
        let markdown = highlight_markdown("# Title\nUse `code`.");
        assert!(markdown.contains("--sh-token-function"));
        assert!(markdown.contains("--sh-token-string"));
        assert_eq!(decode_highlight_text(&markdown), "# Title\nUse `code`.");

        let ansi = highlight_ansi("plain \u{1b}[31mred\u{1b}[0m");
        assert!(ansi.contains("--sh-ansi-red"));
        assert_eq!(decode_highlight_text(&ansi), "plain red");
        assert_constrained_html(&ansi);
    }

    #[test]
    fn unsupported_results_are_cached_and_cache_is_bounded() {
        let runtime = HighlightRuntime::default();
        let first = runtime.highlight(
            &Value::String("value".into()),
            &Value::String("not-a-language".into()),
        );
        let second = runtime.highlight(
            &Value::String("value".into()),
            &Value::String("not-a-language".into()),
        );
        assert_eq!(first, second);
        for index in 0..CACHE_MAX_ENTRIES + 20 {
            runtime.highlight(
                &Value::String(index.to_string()),
                &Value::String("not-a-language".into()),
            );
        }
        let cache = runtime
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(cache.entries.len() <= CACHE_MAX_ENTRIES);
        assert!(cache.bytes <= CACHE_MAX_BYTES);
    }

    fn assert_constrained_html(html: &str) {
        let mut remaining = html;
        while let Some(start) = remaining.find('<') {
            let end = remaining[start..].find('>').expect("closed tag") + start;
            let tag = &remaining[start..=end];
            assert!(
                tag == "</span>"
                    || tag == "<span class=\"line\">"
                    || (tag.starts_with("<span style=\"color:var(--") && tag.ends_with(")\">")),
                "unsafe tag: {tag}"
            );
            remaining = &remaining[end + 1..];
        }
    }

    fn decode_highlight_text(html: &str) -> String {
        html.replace("<span class=\"line\">", "")
            .replace("</span>", "")
            .split("<span style=\"color:var(--")
            .map(|part| part.split_once(")\">").map_or(part, |(_, text)| text))
            .collect::<String>()
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&amp;", "&")
    }
}
