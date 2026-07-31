use std::collections::{HashSet, VecDeque};
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

const TREE_LIMIT: usize = 20_000;
const READ_LIMIT: u64 = 1_000_000;
const SEARCH_DEPTH: usize = 4;
const SEARCH_LIMIT: usize = 50;
const FILE_COMPLETION_LIMIT: usize = 20;
const IGNORE_DIRECTORIES: &[&str] = &[
    ".git",
    ".next",
    ".output",
    ".tanstack",
    "dist",
    "node_modules",
    "target",
];
const SEARCH_IGNORE_DIRECTORIES: &[&str] = &[".cache", ".local", "Applications", "Library"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEntry {
    pub value: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_directory: bool,
}

pub fn resolve_directory(input: &str, base_cwd: &Path) -> io::Result<PathBuf> {
    let input = input.trim();
    if input.is_empty() {
        return Err(invalid("path is required"));
    }
    let expanded = expand_home(input)?;
    let candidate = if expanded.is_absolute() {
        expanded
    } else {
        base_cwd.join(expanded)
    };
    let resolved = std::fs::canonicalize(&candidate).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            invalid(format!("Directory not found: {input}"))
        } else {
            error
        }
    })?;
    if !resolved.is_dir() {
        return Err(invalid(format!("Not a directory: {input}")));
    }
    Ok(resolved)
}

pub fn path_completions(prefix: &str, base_cwd: &Path) -> Vec<CompletionEntry> {
    let normalized = prefix.replace('\\', "/");
    let expanded = expand_home(prefix).unwrap_or_else(|_| PathBuf::from(prefix));
    let ends_with_separator = prefix.ends_with(['/', '\\']);
    let (search_directory, search_prefix) = if prefix.is_empty() {
        (base_cwd.to_path_buf(), String::new())
    } else if ends_with_separator {
        (
            if expanded.is_absolute() {
                expanded
            } else {
                base_cwd.join(expanded)
            },
            String::new(),
        )
    } else {
        let parent = expanded.parent().unwrap_or_else(|| Path::new(""));
        (
            if expanded.is_absolute() {
                parent.to_path_buf()
            } else {
                base_cwd.join(parent)
            },
            expanded
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_lowercase(),
        )
    };
    let Ok(entries) = std::fs::read_dir(search_directory) else {
        return Vec::new();
    };
    let mut results = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with(&search_prefix)
        })
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_directory =
                entry.file_type().ok().is_some_and(|kind| kind.is_dir()) || entry.path().is_dir();
            let mut completion = completion_path(&normalized, &name, ends_with_separator);
            if is_directory {
                completion.push('/');
            }
            CompletionEntry {
                value: completion,
                label: format!("{name}{}", if is_directory { "/" } else { "" }),
                description: None,
                is_directory,
            }
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
    });
    results
}

pub fn file_completions(
    query: &str,
    base_cwd: &Path,
    quoted: bool,
) -> io::Result<Vec<CompletionEntry>> {
    let normalized_query = query.replace('\\', "/");
    let (search_root, display_base, search_query) = scoped_search(&normalized_query, base_cwd)?;
    let search_root = std::fs::canonicalize(search_root)?;
    let mut entries = walk(&search_root, TREE_LIMIT, true)?
        .into_iter()
        .filter_map(|(path, is_directory)| {
            let relative = path.strip_prefix(&search_root).ok()?;
            let relative = display_path(relative);
            let score = file_score(&relative, &search_query, is_directory);
            (score > 0).then_some((relative, is_directory, score))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .2
            .cmp(&left.2)
            .then_with(|| left.0.to_lowercase().cmp(&right.0.to_lowercase()))
    });
    Ok(entries
        .into_iter()
        .take(FILE_COMPLETION_LIMIT)
        .map(|(relative, is_directory, _)| {
            let displayed = format!("{display_base}{relative}");
            let completion = format!("{displayed}{}", if is_directory { "/" } else { "" });
            let needs_quotes = quoted || completion.contains(' ');
            CompletionEntry {
                value: if needs_quotes {
                    format!("@\"{completion}\"")
                } else {
                    format!("@{completion}")
                },
                label: format!(
                    "{}{}",
                    Path::new(&relative)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or(&relative),
                    if is_directory { "/" } else { "" }
                ),
                description: Some(displayed),
                is_directory,
            }
        })
        .collect())
}

pub fn project_tree(base_cwd: &Path) -> io::Result<Vec<String>> {
    let root = std::fs::canonicalize(base_cwd)?;
    let mut paths = walk(&root, TREE_LIMIT, false)?
        .into_iter()
        .filter(|(_, is_directory)| !is_directory)
        .filter_map(|(path, _)| path.strip_prefix(&root).ok().map(display_path))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

pub fn read_project_file(base_cwd: &Path, relative_path: &str) -> io::Result<(String, String)> {
    let normalized = normalize_relative_path(relative_path)?;
    let root = std::fs::canonicalize(base_cwd)?;
    let candidate = root.join(&normalized);
    let resolved = std::fs::canonicalize(&candidate)?;
    if !resolved.starts_with(&root) || resolved == root {
        return Err(invalid("file path must stay inside the directory"));
    }
    let metadata = std::fs::metadata(&resolved)?;
    if !metadata.is_file() {
        return Err(invalid("Not a file"));
    }
    if metadata.len() > READ_LIMIT {
        return Err(invalid("File is too large to preview"));
    }
    let bytes = std::fs::read(&resolved)?;
    if bytes.contains(&0) {
        return Err(invalid("Binary files cannot be previewed"));
    }
    let content =
        String::from_utf8(bytes).map_err(|_| invalid("Binary files cannot be previewed"))?;
    Ok((display_path(&normalized), content))
}

pub fn search_directories(query: &str, base_cwd: &Path) -> io::Result<Vec<CompletionEntry>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let home = home_directory()?;
    let mut roots = vec![home.clone()];
    if !base_cwd.starts_with(&home) {
        roots.push(base_cwd.to_path_buf());
    }
    let mut seen = HashSet::new();
    let mut matches = Vec::new();
    for root in roots {
        let mut queue = VecDeque::from([(root.clone(), 0_usize)]);
        while let Some((directory, depth)) = queue.pop_front() {
            if depth >= SEARCH_DEPTH {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if !kind.is_dir() || kind.is_symlink() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if ignored_for_search(&name) || (!query.starts_with('.') && name.starts_with('.')) {
                    continue;
                }
                let path = entry.path();
                queue.push_back((path.clone(), depth + 1));
                let displayed = display_path(&path);
                if !displayed.to_lowercase().contains(&query) || !seen.insert(displayed.clone()) {
                    continue;
                }
                let lower_name = name.to_lowercase();
                let score = if lower_name == query {
                    1000
                } else if lower_name.starts_with(&query) {
                    800
                } else if lower_name.contains(&query) {
                    600
                } else {
                    300
                } - (depth as i32 * 5);
                matches.push((
                    score,
                    CompletionEntry {
                        value: displayed.clone(),
                        label: format!("{name}/"),
                        description: Some(displayed),
                        is_directory: true,
                    },
                ));
            }
        }
    }
    matches.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.value.cmp(&right.1.value))
    });
    Ok(matches
        .into_iter()
        .take(SEARCH_LIMIT)
        .map(|(_, entry)| entry)
        .collect())
}

fn walk(root: &Path, limit: usize, include_directories: bool) -> io::Result<Vec<(PathBuf, bool)>> {
    let root = std::fs::canonicalize(root)?;
    let mut queue = VecDeque::from([root.clone()]);
    let mut output = Vec::new();
    while let Some(directory) = queue.pop_front() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => continue,
            Err(error) => return Err(error),
        };
        for entry in entries.filter_map(Result::ok) {
            if output.len() >= limit {
                return Ok(output);
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if ignored(&name) {
                    continue;
                }
                queue.push_back(entry.path());
                if include_directories {
                    output.push((entry.path(), true));
                }
            } else if kind.is_file() {
                output.push((entry.path(), false));
            }
        }
    }
    Ok(output)
}

fn scoped_search(query: &str, base_cwd: &Path) -> io::Result<(PathBuf, String, String)> {
    let Some(index) = query.rfind('/') else {
        return Ok((base_cwd.to_path_buf(), String::new(), query.into()));
    };
    let display_base = &query[..=index];
    let search_query = &query[index + 1..];
    let expanded = expand_home(display_base)?;
    let root = if expanded.is_absolute() {
        expanded
    } else {
        base_cwd.join(expanded)
    };
    let root = std::fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(invalid("completion scope is not a directory"));
    }
    Ok((root, display_base.into(), search_query.into()))
}

fn file_score(path: &str, query: &str, is_directory: bool) -> i32 {
    if query.is_empty() {
        return 1;
    }
    let lower_query = query.to_lowercase();
    let lower_path = path.to_lowercase();
    let name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_lowercase();
    let mut score = if name == lower_query {
        100
    } else if name.starts_with(&lower_query) {
        80
    } else if name.contains(&lower_query) {
        50
    } else if lower_path.contains(&lower_query) {
        30
    } else {
        0
    };
    if is_directory && score > 0 {
        score += 10;
    }
    score
}

fn completion_path(prefix: &str, name: &str, ends_with_separator: bool) -> String {
    if ends_with_separator {
        return format!("{prefix}{name}");
    }
    if let Some(index) = prefix.rfind('/') {
        return format!("{}{name}", &prefix[..=index]);
    }
    if prefix == "~" {
        return format!("~/{name}");
    }
    name.into()
}

fn normalize_relative_path(path: &str) -> io::Result<PathBuf> {
    let normalized = path.trim().trim_start_matches("./");
    if normalized.is_empty() {
        return Err(invalid("file path is required"));
    }
    let path = Path::new(normalized);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(invalid("file path must stay inside the directory"));
    }
    Ok(path.to_path_buf())
}

fn expand_home(path: &str) -> io::Result<PathBuf> {
    if path == "~" {
        return home_directory();
    }
    if let Some(suffix) = path.strip_prefix("~/") {
        return Ok(home_directory()?.join(suffix));
    }
    Ok(PathBuf::from(path))
}

fn home_directory() -> io::Result<PathBuf> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn ignored(name: &str) -> bool {
    IGNORE_DIRECTORIES.contains(&name)
}

fn ignored_for_search(name: &str) -> bool {
    ignored(name) || SEARCH_IGNORE_DIRECTORIES.contains(&name)
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pico-project-files-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("src/你好")).expect("create fixture");
        std::fs::write(root.join("src/你好/main.rs"), "fn main() {}\n").expect("write text");
        std::fs::write(root.join("binary.bin"), b"hello\0world").expect("write binary");
        std::fs::write(root.join("large.txt"), vec![b'x'; READ_LIMIT as usize + 1])
            .expect("write large");
        root
    }

    #[test]
    fn tree_and_reads_preserve_unicode_and_reject_unsafe_files() {
        let root = fixture();
        let tree = project_tree(&root).expect("tree");
        assert!(tree.contains(&"src/你好/main.rs".into()));
        assert_eq!(
            read_project_file(&root, "src/你好/main.rs")
                .expect("read")
                .1,
            "fn main() {}\n"
        );
        assert!(read_project_file(&root, "../outside").is_err());
        assert!(read_project_file(&root, "binary.bin").is_err());
        assert!(read_project_file(&root, "large.txt").is_err());
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn completions_are_ordered_bounded_and_quote_spaces() {
        let root = fixture();
        std::fs::create_dir_all(root.join("space dir")).expect("space dir");
        std::fs::write(root.join("space dir/note.md"), "note").expect("note");
        let path_items = path_completions("s", &root);
        assert!(path_items.first().is_some_and(|item| item.is_directory));
        let file_items = file_completions("note", &root, false).expect("file completions");
        assert!(file_items.len() <= FILE_COMPLETION_LIMIT);
        assert_eq!(file_items[0].value, "@\"space dir/note.md\"");
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escapes_are_rejected_and_not_walked() {
        use std::os::unix::fs::symlink;
        let root = fixture();
        let outside = root.parent().expect("parent").join("pico-outside.txt");
        std::fs::write(&outside, "secret").expect("outside");
        symlink(&outside, root.join("escape.txt")).expect("symlink");
        assert!(read_project_file(&root, "escape.txt").is_err());
        assert!(!project_tree(&root)
            .expect("tree")
            .contains(&"escape.txt".into()));
        std::fs::remove_file(outside).expect("remove outside");
        std::fs::remove_dir_all(root).expect("remove fixture");
    }
}
