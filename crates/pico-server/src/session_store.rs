use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::protocol::{
    AssistantBlock, AssistantConversationItem, CompactionBlock, ConversationItem, ModelOption,
    PromptImage, SessionListEntry, TextBlock, ThinkingBlock, ToolBlock, UserConversationItem,
};

const MAX_SESSION_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSION_COUNT: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionHeader {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub version: u32,
    pub id: String,
    pub timestamp: String,
    pub cwd: PathBuf,
    #[serde(rename = "parentSession", default)]
    pub parent_session: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct SessionDocument {
    pub path: PathBuf,
    pub header: SessionHeader,
    pub entries: Vec<Value>,
    pub active_entries: Vec<Value>,
    pub leaf_id: Option<String>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct IndexedSessionFile {
    pub path: PathBuf,
    pub header: SessionHeader,
    pub modified: Option<String>,
    pub revision: String,
}

impl SessionStore {
    pub fn new(agent_dir: &Path) -> Self {
        Self {
            root: agent_dir.join("sessions"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load(&self, path: &Path) -> io::Result<SessionDocument> {
        SessionDocument::load(path)
    }

    pub fn find(&self, selection: &str) -> io::Result<Option<SessionDocument>> {
        let selection_path = Path::new(selection);
        if selection_path.is_absolute() && selection_path.is_file() {
            return self.load(selection_path).map(Some);
        }
        let index = self.list_index()?;
        if let Some(indexed) = index.iter().find(|indexed| {
            indexed.header.id == selection || indexed.path.to_string_lossy() == selection
        }) {
            return self.load(&indexed.path).map(Some);
        }
        Ok(None)
    }

    pub fn list_index(&self) -> io::Result<Vec<IndexedSessionFile>> {
        let mut files = Vec::new();
        collect_session_files(&self.root, &mut files)?;
        files.sort();
        files.truncate(MAX_SESSION_COUNT);
        let mut index = Vec::new();
        for path in files {
            match index_session_file(&path) {
                Ok(indexed) => index.push(indexed),
                Err(error) => tracing::warn!(
                    %error,
                    path = %path.display(),
                    "skipping unreadable Pi session header"
                ),
            }
        }
        index.sort_by(|left, right| right.modified.cmp(&left.modified));
        Ok(index)
    }

    pub fn list_all(&self) -> io::Result<Vec<SessionDocument>> {
        self.load_indexed(self.list_index()?)
    }

    pub fn list_directory(&self, cwd: &Path) -> io::Result<Vec<SessionDocument>> {
        let index = self.list_index()?;
        self.load_indexed(
            index
                .into_iter()
                .filter(|indexed| indexed.header.cwd == cwd),
        )
    }

    fn load_indexed(
        &self,
        indexed_files: impl IntoIterator<Item = IndexedSessionFile>,
    ) -> io::Result<Vec<SessionDocument>> {
        let mut documents = Vec::new();
        for indexed in indexed_files {
            match self.load(&indexed.path) {
                Ok(document) => documents.push(document),
                Err(error) => tracing::warn!(
                    %error,
                    path = %indexed.path.display(),
                    "skipping unreadable Pi session"
                ),
            }
        }
        documents.sort_by(|left, right| right.modified.cmp(&left.modified));
        Ok(documents)
    }
}

impl SessionDocument {
    pub fn load(path: &Path) -> io::Result<Self> {
        let metadata = std::fs::metadata(path)?;
        if !metadata.is_file() || metadata.len() > MAX_SESSION_FILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "session file is not a supported regular file",
            ));
        }
        let file = std::fs::File::open(path)?;
        let mut lines = io::BufReader::new(file).lines();
        let header_line = lines
            .next()
            .transpose()?
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "empty session file"))?;
        let header: SessionHeader = serde_json::from_str(&header_line)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if header.kind != "session" || header.id.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid Pi session header",
            ));
        }

        let entry_lines = lines.collect::<Result<Vec<_>, _>>()?;
        let last_nonempty_index = entry_lines.iter().rposition(|line| !line.trim().is_empty());
        let mut entries = Vec::new();
        for (index, line) in entry_lines.into_iter().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str(&line) {
                Ok(entry) => entries.push(entry),
                Err(error) if Some(index) == last_nonempty_index => {
                    tracing::debug!(
                        %error,
                        path = %path.display(),
                        "ignoring an incomplete trailing Pi session entry"
                    );
                }
                Err(error) => {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, error));
                }
            }
        }
        let (active_entries, leaf_id) = active_path(&entries);
        Ok(Self {
            path: path.to_path_buf(),
            header,
            entries,
            active_entries,
            leaf_id,
            modified: metadata.modified().ok().and_then(format_system_time),
        })
    }

    pub fn session_name(&self) -> Option<String> {
        self.active_entries.iter().rev().find_map(|entry| {
            (entry_type(entry) == Some("session_info"))
                .then(|| entry.get("name").and_then(Value::as_str))
                .flatten()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
    }

    pub fn first_user_message(&self) -> String {
        self.active_entries
            .iter()
            .find_map(|entry| message_with_role(entry, "user").map(message_text))
            .unwrap_or_default()
    }

    pub fn last_message_preview(&self) -> Option<String> {
        self.active_entries.iter().rev().find_map(|entry| {
            let message = entry.get("message")?;
            let role = message.get("role").and_then(Value::as_str)?;
            matches!(role, "user" | "assistant")
                .then(|| truncate_preview(&message_text(message), 160))
                .filter(|preview| !preview.is_empty())
        })
    }

    pub fn message_count(&self) -> usize {
        self.active_entries
            .iter()
            .filter(|entry| entry_type(entry) == Some("message"))
            .count()
    }

    pub fn model(&self) -> Option<ModelOption> {
        for entry in self.active_entries.iter().rev() {
            if entry_type(entry) == Some("model_change") {
                let id = entry.get("modelId").and_then(Value::as_str)?;
                return Some(ModelOption {
                    id: id.into(),
                    provider: entry
                        .get("provider")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    name: None,
                    reasoning: None,
                });
            }
            if let Some(message) = message_with_role(entry, "assistant") {
                if let Some(id) = message.get("model").and_then(Value::as_str) {
                    return Some(ModelOption {
                        id: id.into(),
                        provider: message
                            .get("provider")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        name: None,
                        reasoning: None,
                    });
                }
            }
        }
        None
    }

    pub fn thinking_level(&self) -> Option<String> {
        self.active_entries.iter().rev().find_map(|entry| {
            (entry_type(entry) == Some("thinking_level_change"))
                .then(|| entry.get("thinkingLevel").and_then(Value::as_str))
                .flatten()
                .map(str::to_string)
        })
    }

    pub fn summary(&self) -> SessionListEntry {
        let first_message = self.first_user_message();
        let name = self.session_name();
        let title = name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| {
                let first = truncate_preview(&first_message, 80);
                if first.is_empty() {
                    "New session".into()
                } else {
                    first
                }
            });
        SessionListEntry {
            path: Some(self.path.clone()),
            id: Some(self.header.id.clone()),
            cwd: Some(self.header.cwd.clone()),
            name,
            title,
            modified: self.modified.clone(),
            last_user_message_at: None,
            last_message_at: self.active_entries.iter().rev().find_map(|entry| {
                entry
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }),
            last_message_preview: self.last_message_preview(),
            message_count: Some(self.message_count()),
            context_usage: None,
            streaming: Some(false),
            unread: Some(false),
            optimistic: None,
        }
    }

    pub fn conversation_items(&self) -> Vec<ConversationItem> {
        let mut items = Vec::new();
        let mut tools = HashMap::<String, (usize, usize)>::new();
        for entry in &self.active_entries {
            let entry_id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            match entry_type(entry) {
                Some("message") => {
                    let Some(message) = entry.get("message") else {
                        continue;
                    };
                    match message.get("role").and_then(Value::as_str) {
                        Some("user") => items.push(ConversationItem::User(UserConversationItem {
                            item_key: Some(format!("entry:{entry_id}")),
                            render_key: None,
                            pending_id: None,
                            fork_entry_id: Some(entry_id),
                            text: message_text(message),
                            images: message_images(message),
                            queued: None,
                            streaming_behavior: None,
                        })),
                        Some("assistant") => {
                            let mut blocks = assistant_blocks(message, &entry_id);
                            let item_index = items.len();
                            for (block_index, block) in blocks.iter().enumerate() {
                                if let AssistantBlock::Tool(tool) = block {
                                    if let Some(call_id) = &tool.call_id {
                                        tools.insert(call_id.clone(), (item_index, block_index));
                                    }
                                }
                            }
                            if blocks.is_empty() {
                                if let Some(error) = message
                                    .get("errorMessage")
                                    .and_then(Value::as_str)
                                    .filter(|error| !error.is_empty())
                                {
                                    blocks.push(AssistantBlock::Text(TextBlock {
                                        block_key: Some(format!("entry:{entry_id}:error")),
                                        render_key: None,
                                        text: error.into(),
                                        is_error: Some(true),
                                    }));
                                }
                            }
                            items.push(ConversationItem::Assistant(AssistantConversationItem {
                                item_key: Some(format!("entry:{entry_id}")),
                                render_key: None,
                                branch_entry_id: Some(entry_id),
                                blocks,
                                streaming: Some(false),
                                done: Some(true),
                                model: assistant_model(message),
                            }));
                        }
                        Some("toolResult") => {
                            apply_tool_result(&mut items, &tools, message);
                        }
                        _ => {}
                    }
                }
                Some("compaction") => {
                    let summary = entry
                        .get("summary")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let tokens_before = entry
                        .get("tokensBefore")
                        .and_then(Value::as_u64)
                        .unwrap_or_default();
                    items.push(ConversationItem::Assistant(AssistantConversationItem {
                        item_key: Some(format!("entry:{entry_id}")),
                        render_key: None,
                        branch_entry_id: Some(entry_id.clone()),
                        blocks: vec![AssistantBlock::Compaction(CompactionBlock {
                            block_key: Some(format!("entry:{entry_id}:compaction")),
                            render_key: None,
                            summary,
                            tokens_before,
                            estimated_tokens_after: entry
                                .get("estimatedTokensAfter")
                                .and_then(Value::as_u64),
                        })],
                        streaming: Some(false),
                        done: Some(true),
                        model: None,
                    }));
                }
                _ => {}
            }
        }
        items
    }

    pub fn revision(&self) -> String {
        let metadata = std::fs::metadata(&self.path).ok();
        format!(
            "{}:{}",
            self.entries.len(),
            metadata
                .map(|metadata| file_revision(metadata.len(), metadata.modified().ok()))
                .unwrap_or_default()
        )
    }
}

fn index_session_file(path: &Path) -> io::Result<IndexedSessionFile> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() > MAX_SESSION_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session file is not a supported regular file",
        ));
    }
    let file = std::fs::File::open(path)?;
    let header_line = io::BufReader::new(file)
        .lines()
        .next()
        .transpose()?
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "empty session file"))?;
    let header: SessionHeader = serde_json::from_str(&header_line)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if header.kind != "session" || header.id.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Pi session header",
        ));
    }
    let modified_time = metadata.modified().ok();
    Ok(IndexedSessionFile {
        path: path.to_path_buf(),
        header,
        modified: modified_time.and_then(format_system_time),
        revision: file_revision(metadata.len(), modified_time),
    })
}

fn collect_session_files(directory: &Path, output: &mut Vec<PathBuf>) -> io::Result<()> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_session_files(&entry.path(), output)?;
        } else if file_type.is_file() && entry.path().extension().is_some_and(|ext| ext == "jsonl")
        {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn active_path(entries: &[Value]) -> (Vec<Value>, Option<String>) {
    let by_id = entries
        .iter()
        .filter_map(|entry| Some((entry.get("id")?.as_str()?.to_string(), entry)))
        .collect::<HashMap<_, _>>();
    let leaf_id = entries
        .iter()
        .rev()
        .find_map(|entry| entry.get("id").and_then(Value::as_str).map(str::to_string));
    let mut current = leaf_id.clone();
    let mut seen = HashSet::new();
    let mut reversed = Vec::new();
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some(entry) = by_id.get(&id) else {
            break;
        };
        reversed.push((*entry).clone());
        current = entry
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    reversed.reverse();
    (reversed, leaf_id)
}

fn entry_type(entry: &Value) -> Option<&str> {
    entry.get("type").and_then(Value::as_str)
}

fn message_with_role<'a>(entry: &'a Value, role: &str) -> Option<&'a Value> {
    (entry_type(entry) == Some("message"))
        .then(|| entry.get("message"))
        .flatten()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some(role))
}

fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn message_images(message: &Value) -> Vec<PromptImage> {
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("image"))
        .filter_map(|part| {
            let mime_type = part.get("mimeType")?.as_str()?.to_string();
            let data = part.get("data")?.as_str()?.to_string();
            Some(PromptImage {
                r#type: Some("image".into()),
                preview_url: Some(format!("data:{mime_type};base64,{data}")),
                mime_type,
                data,
            })
        })
        .collect()
}

pub fn streaming_assistant_item(message: &Value) -> ConversationItem {
    ConversationItem::Assistant(AssistantConversationItem {
        item_key: Some("streaming".into()),
        render_key: Some("streaming".into()),
        branch_entry_id: None,
        blocks: assistant_blocks(message, "streaming"),
        streaming: Some(true),
        done: Some(false),
        model: assistant_model(message),
    })
}

pub fn update_streaming_tool(
    item: &mut ConversationItem,
    call_id: &str,
    output: Option<String>,
    details: Option<Value>,
    is_error: Option<bool>,
    running: bool,
) {
    let ConversationItem::Assistant(assistant) = item else {
        return;
    };
    let Some(AssistantBlock::Tool(tool)) = assistant
        .blocks
        .iter_mut()
        .rev()
        .find(|block| matches!(block, AssistantBlock::Tool(tool) if tool.call_id.as_deref() == Some(call_id)))
    else {
        return;
    };
    if let Some(output) = output {
        tool.output = output;
    }
    if details.is_some() {
        tool.details = details;
    }
    if let Some(is_error) = is_error {
        tool.is_error = is_error;
    }
    tool.running = running;
}

fn assistant_blocks(message: &Value, entry_id: &str) -> Vec<AssistantBlock> {
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(
            |(index, part)| match part.get("type").and_then(Value::as_str) {
                Some("text") => Some(AssistantBlock::Text(TextBlock {
                    block_key: Some(format!("entry:{entry_id}:part:{index}:text")),
                    render_key: None,
                    text: part
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    is_error: None,
                })),
                Some("thinking") => Some(AssistantBlock::Thinking(ThinkingBlock {
                    block_key: Some(format!("entry:{entry_id}:part:{index}:thinking")),
                    render_key: None,
                    text: part
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    summary_label: part
                        .get("summaryLabel")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })),
                Some("toolCall") => {
                    let call_id = part.get("id").and_then(Value::as_str).map(str::to_string);
                    Some(AssistantBlock::Tool(ToolBlock {
                        block_key: Some(format!(
                            "entry:{entry_id}:tool:{}",
                            call_id.as_deref().unwrap_or("unknown")
                        )),
                        render_key: None,
                        call_id,
                        name: part.get("name").and_then(Value::as_str).map(str::to_string),
                        args: part.get("arguments").cloned(),
                        category: None,
                        output: String::new(),
                        details: None,
                        is_error: false,
                        running: true,
                    }))
                }
                _ => None,
            },
        )
        .collect()
}

fn assistant_model(message: &Value) -> Option<ModelOption> {
    Some(ModelOption {
        id: message.get("model")?.as_str()?.to_string(),
        provider: message
            .get("provider")
            .and_then(Value::as_str)
            .map(str::to_string),
        name: None,
        reasoning: None,
    })
}

fn apply_tool_result(
    items: &mut [ConversationItem],
    tools: &HashMap<String, (usize, usize)>,
    message: &Value,
) {
    let Some(call_id) = message.get("toolCallId").and_then(Value::as_str) else {
        return;
    };
    let Some((item_index, block_index)) = tools.get(call_id).copied() else {
        return;
    };
    let Some(ConversationItem::Assistant(assistant)) = items.get_mut(item_index) else {
        return;
    };
    let Some(AssistantBlock::Tool(tool)) = assistant.blocks.get_mut(block_index) else {
        return;
    };
    tool.output = message_text(message);
    tool.details = message.get("details").cloned();
    tool.is_error = message
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    tool.running = false;
}

fn truncate_preview(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut truncated = normalized
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn file_revision(length: u64, modified: Option<SystemTime>) -> String {
    format!(
        "{}:{}",
        length,
        modified
            .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    )
}

fn format_system_time(value: SystemTime) -> Option<String> {
    OffsetDateTime::from(value).format(&Rfc3339).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    fn fixture(entries: &[Value]) -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "pico-session-store-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("session.jsonl");
        let mut lines = vec![serde_json::json!({
          "type": "session",
          "version": 3,
          "id": "session-1",
          "timestamp": "2026-07-31T00:00:00.000Z",
          "cwd": "/tmp/project"
        })];
        lines.extend_from_slice(entries);
        std::fs::write(
            &path,
            lines
                .into_iter()
                .map(|line| line.to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .expect("write fixture");
        (directory, path)
    }

    #[test]
    fn active_branch_and_conversation_items_follow_parent_ids() {
        let (directory, path) = fixture(&[
            serde_json::json!({
              "type": "message", "id": "u1", "parentId": null,
              "timestamp": "2026-07-31T00:00:01.000Z",
              "message": {"role": "user", "content": "first", "timestamp": 1}
            }),
            serde_json::json!({
              "type": "message", "id": "a1", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:02.000Z",
              "message": {"role": "assistant", "content": [{"type":"text","text":"old"}], "provider":"test", "model":"one", "stopReason":"stop", "timestamp": 2}
            }),
            serde_json::json!({
              "type": "message", "id": "u2", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:03.000Z",
              "message": {"role": "user", "content": "branch", "timestamp": 3}
            }),
        ]);
        let document = SessionDocument::load(&path).expect("load");
        assert_eq!(document.leaf_id.as_deref(), Some("u2"));
        assert_eq!(document.active_entries.len(), 2);
        assert_eq!(document.first_user_message(), "first");
        assert_eq!(document.last_message_preview().as_deref(), Some("branch"));
        assert_eq!(document.conversation_items().len(), 2);
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn tool_results_update_the_matching_tool_block() {
        let (directory, path) = fixture(&[
            serde_json::json!({
              "type": "message", "id": "u1", "parentId": null,
              "timestamp": "2026-07-31T00:00:01.000Z",
              "message": {"role": "user", "content": "read", "timestamp": 1}
            }),
            serde_json::json!({
              "type": "message", "id": "a1", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:02.000Z",
              "message": {"role": "assistant", "content": [{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"README.md"}}], "provider":"test", "model":"one", "stopReason":"toolUse", "timestamp": 2}
            }),
            serde_json::json!({
              "type": "message", "id": "t1", "parentId": "a1",
              "timestamp": "2026-07-31T00:00:03.000Z",
              "message": {"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"# Hello"}],"isError":false,"timestamp":3}
            }),
        ]);
        let document = SessionDocument::load(&path).expect("load");
        let items = document.conversation_items();
        let ConversationItem::Assistant(assistant) = &items[1] else {
            panic!("expected assistant");
        };
        let AssistantBlock::Tool(tool) = &assistant.blocks[0] else {
            panic!("expected tool");
        };
        assert_eq!(tool.output, "# Hello");
        assert!(!tool.running);
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }
}
