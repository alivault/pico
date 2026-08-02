use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::de::{DeserializeOwned, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::protocol::{
    AssistantBlock, AssistantConversationItem, CompactionBlock, ConversationItem, ModelOption,
    PromptImage, SessionListEntry, TextBlock, ThinkingBlock, ToolBlock, UserConversationItem,
};

const MAX_SESSION_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSION_COUNT: usize = 20_000;
const MAX_CACHED_DOCUMENTS: usize = 4;
const MAX_CACHED_DOCUMENT_SOURCE_BYTES: u64 = 96 * 1024 * 1024;
const SUMMARY_TEXT_CHARS: usize = 1024;

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

#[derive(Debug)]
pub struct SessionDocument {
    pub path: PathBuf,
    pub header: SessionHeader,
    pub entries: Vec<Value>,
    active_entry_indices: Vec<usize>,
    pub leaf_id: Option<String>,
    pub modified: Option<String>,
    revision: String,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    root: PathBuf,
    cache: Arc<Mutex<SessionCache>>,
}

#[derive(Debug, Default)]
struct SessionCache {
    access_counter: u64,
    document_source_bytes: u64,
    documents: HashMap<PathBuf, CachedDocument>,
    summaries: HashMap<PathBuf, CachedSummary>,
}

#[derive(Debug)]
struct CachedDocument {
    revision: String,
    source_bytes: u64,
    last_access: u64,
    document: Arc<SessionDocument>,
}

#[derive(Debug, Clone)]
struct CachedSummary {
    revision: String,
    summary: SessionListEntry,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryEntry {
    #[serde(rename = "type")]
    kind: Option<String>,
    id: Option<String>,
    parent_id: Option<String>,
    timestamp: Option<String>,
    name: Option<String>,
    message: Option<SummaryMessage>,
}

#[derive(Debug, Deserialize)]
struct SummaryMessage {
    role: Option<String>,
    #[serde(default, deserialize_with = "deserialize_summary_content")]
    content: String,
}

#[derive(Debug, Deserialize)]
struct SummaryContentPart {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    text: BoundedText,
}

#[derive(Debug, Default)]
struct BoundedText(String);

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
            cache: Arc::new(Mutex::new(SessionCache::default())),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load(&self, path: &Path) -> io::Result<Arc<SessionDocument>> {
        let metadata = supported_session_metadata(path)?;
        let revision = file_revision(metadata.len(), metadata.modified().ok());
        {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            cache.access_counter = cache.access_counter.saturating_add(1);
            let access = cache.access_counter;
            if let Some(cached) = cache.documents.get_mut(path) {
                if cached.revision == revision {
                    cached.last_access = access;
                    return Ok(cached.document.clone());
                }
            }
        }

        let document = Arc::new(SessionDocument::load_with_metadata(
            path,
            metadata,
            revision.clone(),
        )?);
        let source_bytes = std::fs::metadata(path)?.len();
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.access_counter = cache.access_counter.saturating_add(1);
        let access = cache.access_counter;
        if let Some(previous) = cache.documents.insert(
            path.to_path_buf(),
            CachedDocument {
                revision,
                source_bytes,
                last_access: access,
                document: document.clone(),
            },
        ) {
            cache.document_source_bytes = cache
                .document_source_bytes
                .saturating_sub(previous.source_bytes);
        }
        cache.document_source_bytes = cache.document_source_bytes.saturating_add(source_bytes);
        cache.evict_documents();
        Ok(document)
    }

    pub fn find(&self, selection: &str) -> io::Result<Option<Arc<SessionDocument>>> {
        let Some(indexed) = self.find_indexed(selection)? else {
            return Ok(None);
        };
        self.load(&indexed.path).map(Some)
    }

    pub fn find_indexed(&self, selection: &str) -> io::Result<Option<IndexedSessionFile>> {
        let selection_path = Path::new(selection);
        if selection_path.is_absolute() && selection_path.is_file() {
            return index_session_file(selection_path).map(Some);
        }
        Ok(self.list_index()?.into_iter().find(|indexed| {
            indexed.header.id == selection || indexed.path.to_string_lossy() == selection
        }))
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

    pub fn summaries(&self, indexed_files: &[IndexedSessionFile]) -> Vec<SessionListEntry> {
        indexed_files
            .iter()
            .filter_map(|indexed| match self.summary(indexed) {
                Ok(summary) => Some(summary),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        path = %indexed.path.display(),
                        "skipping unreadable Pi session summary"
                    );
                    None
                }
            })
            .collect()
    }

    pub fn summary(&self, indexed: &IndexedSessionFile) -> io::Result<SessionListEntry> {
        {
            let cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(cached) = cache.summaries.get(&indexed.path) {
                if cached.revision == indexed.revision {
                    return Ok(cached.summary.clone());
                }
            }
        }
        let summary = load_session_summary(indexed)?;
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .summaries
            .insert(
                indexed.path.clone(),
                CachedSummary {
                    revision: indexed.revision.clone(),
                    summary: summary.clone(),
                },
            );
        Ok(summary)
    }

    pub fn invalidate(&self, path: &Path) {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(document) = cache.documents.remove(path) {
            cache.document_source_bytes = cache
                .document_source_bytes
                .saturating_sub(document.source_bytes);
        }
        cache.summaries.remove(path);
    }
}

impl SessionCache {
    fn evict_documents(&mut self) {
        while self.documents.len() > MAX_CACHED_DOCUMENTS
            || (self.document_source_bytes > MAX_CACHED_DOCUMENT_SOURCE_BYTES
                && self.documents.len() > 1)
        {
            let Some(path) = self
                .documents
                .iter()
                .min_by_key(|(_, document)| document.last_access)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            if let Some(document) = self.documents.remove(&path) {
                self.document_source_bytes = self
                    .document_source_bytes
                    .saturating_sub(document.source_bytes);
            }
        }
    }
}

impl SessionDocument {
    pub fn load(path: &Path) -> io::Result<Self> {
        let metadata = supported_session_metadata(path)?;
        let revision = file_revision(metadata.len(), metadata.modified().ok());
        Self::load_with_metadata(path, metadata, revision)
    }

    fn load_with_metadata(
        path: &Path,
        metadata: std::fs::Metadata,
        revision: String,
    ) -> io::Result<Self> {
        let file = std::fs::File::open(path)?;
        let mut reader = io::BufReader::new(file);
        let header = read_session_header(&mut reader)?;
        let entries = read_jsonl_tail::<Value>(&mut reader, path)?;
        let (active_entry_indices, leaf_id) = active_path(&entries);
        Ok(Self {
            path: path.to_path_buf(),
            header,
            entries,
            active_entry_indices,
            leaf_id,
            modified: metadata.modified().ok().and_then(format_system_time),
            revision,
        })
    }

    fn active_entries(&self) -> impl DoubleEndedIterator<Item = &Value> {
        self.active_entry_indices
            .iter()
            .filter_map(|index| self.entries.get(*index))
    }

    pub fn session_name(&self) -> Option<String> {
        self.active_entries().rev().find_map(|entry| {
            (entry_type(entry) == Some("session_info"))
                .then(|| entry.get("name").and_then(Value::as_str))
                .flatten()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
    }

    pub fn first_user_message(&self) -> String {
        self.active_entries()
            .find_map(|entry| message_with_role(entry, "user").map(message_text))
            .unwrap_or_default()
    }

    pub fn last_message_preview(&self) -> Option<String> {
        self.active_entries().rev().find_map(|entry| {
            let message = entry.get("message")?;
            let role = message.get("role").and_then(Value::as_str)?;
            matches!(role, "user" | "assistant")
                .then(|| truncate_preview(&message_text(message), 160))
                .filter(|preview| !preview.is_empty())
        })
    }

    pub fn message_count(&self) -> usize {
        self.active_entries()
            .filter(|entry| entry_type(entry) == Some("message"))
            .count()
    }

    pub fn model(&self) -> Option<ModelOption> {
        for entry in self.active_entries().rev() {
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
        self.active_entries().rev().find_map(|entry| {
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
            last_message_at: self.active_entries().rev().find_map(|entry| {
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

    pub fn messages(&self) -> Vec<Value> {
        self.active_entries()
            .filter_map(|entry| match entry_type(entry) {
                Some("message") => entry.get("message").map(sanitize_message),
                Some("compaction") => Some(json_compaction_message(entry)),
                Some("branch_summary") => Some(serde_json::json!({
                  "role": "branchSummary",
                  "summary": entry.get("summary").and_then(Value::as_str).unwrap_or_default(),
                  "timestamp": entry.get("timestamp")
                })),
                Some("custom_message") => Some(serde_json::json!({
                  "role": "custom",
                  "customType": entry.get("customType"),
                  "content": entry.get("content"),
                  "display": entry.get("display"),
                  "details": entry.get("details")
                })),
                _ => None,
            })
            .collect()
    }

    pub fn conversation_items(&self) -> Vec<ConversationItem> {
        let mut items = Vec::new();
        let mut tools = HashMap::<String, (usize, usize)>::new();
        for entry in self.active_entries() {
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
        format!("{}:{}", self.entries.len(), self.revision)
    }
}

fn index_session_file(path: &Path) -> io::Result<IndexedSessionFile> {
    let metadata = supported_session_metadata(path)?;
    let file = std::fs::File::open(path)?;
    let header = read_session_header(&mut io::BufReader::new(file))?;
    let modified_time = metadata.modified().ok();
    Ok(IndexedSessionFile {
        path: path.to_path_buf(),
        header,
        modified: modified_time.and_then(format_system_time),
        revision: file_revision(metadata.len(), modified_time),
    })
}

fn supported_session_metadata(path: &Path) -> io::Result<std::fs::Metadata> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() > MAX_SESSION_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session file is not a supported regular file",
        ));
    }
    Ok(metadata)
}

fn read_session_header(reader: &mut impl BufRead) -> io::Result<SessionHeader> {
    let mut header_line = String::new();
    if reader.read_line(&mut header_line)? == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "empty session file",
        ));
    }
    let header: SessionHeader = serde_json::from_str(&header_line)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if header.kind != "session" || header.id.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Pi session header",
        ));
    }
    Ok(header)
}

fn read_jsonl_tail<T: DeserializeOwned>(
    reader: &mut impl BufRead,
    path: &Path,
) -> io::Result<Vec<T>> {
    let mut values = Vec::new();
    let mut line = String::new();
    let mut trailing_error = None;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Some(error) = trailing_error.take() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, error));
        }
        match serde_json::from_str(&line) {
            Ok(value) => values.push(value),
            Err(error) => trailing_error = Some(error),
        }
    }
    if let Some(error) = trailing_error {
        tracing::debug!(
            %error,
            path = %path.display(),
            "ignoring an incomplete trailing Pi session entry"
        );
    }
    Ok(values)
}

fn load_session_summary(indexed: &IndexedSessionFile) -> io::Result<SessionListEntry> {
    let file = std::fs::File::open(&indexed.path)?;
    let mut reader = io::BufReader::new(file);
    let header = read_session_header(&mut reader)?;
    let entries = read_jsonl_tail::<SummaryEntry>(&mut reader, &indexed.path)?;
    let active = active_summary_path(&entries);
    let name = active.iter().rev().find_map(|index| {
        let entry = &entries[*index];
        (entry.kind.as_deref() == Some("session_info"))
            .then_some(entry.name.as_deref())
            .flatten()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    });
    let first_message = active
        .iter()
        .filter_map(|index| entries[*index].message.as_ref())
        .find(|message| message.role.as_deref() == Some("user"))
        .map(|message| message.content.clone())
        .unwrap_or_default();
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
    let last_message_preview = active.iter().rev().find_map(|index| {
        let message = entries[*index].message.as_ref()?;
        matches!(message.role.as_deref(), Some("user" | "assistant"))
            .then(|| truncate_preview(&message.content, 160))
            .filter(|preview| !preview.is_empty())
    });
    Ok(SessionListEntry {
        path: Some(indexed.path.clone()),
        id: Some(header.id),
        cwd: Some(header.cwd),
        name,
        title,
        modified: indexed.modified.clone(),
        last_user_message_at: None,
        last_message_at: active
            .iter()
            .rev()
            .find_map(|index| entries[*index].timestamp.clone()),
        last_message_preview,
        message_count: Some(
            active
                .iter()
                .filter(|index| entries[**index].kind.as_deref() == Some("message"))
                .count(),
        ),
        context_usage: None,
        streaming: Some(false),
        unread: Some(false),
        optimistic: None,
    })
}

fn active_summary_path(entries: &[SummaryEntry]) -> Vec<usize> {
    let by_id = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| Some((entry.id.as_deref()?, index)))
        .collect::<HashMap<_, _>>();
    let mut current = entries.iter().rev().find_map(|entry| entry.id.as_deref());
    let mut seen = HashSet::new();
    let mut reversed = Vec::new();
    while let Some(id) = current {
        if !seen.insert(id) {
            break;
        }
        let Some(index) = by_id.get(id).copied() else {
            break;
        };
        reversed.push(index);
        current = entries[index].parent_id.as_deref();
    }
    reversed.reverse();
    reversed
}

impl<'de> Deserialize<'de> for BoundedText {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct BoundedTextVisitor;

        impl Visitor<'_> for BoundedTextVisitor {
            type Value = BoundedText;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
                Ok(BoundedText(bounded_summary_text(value)))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(BoundedText(bounded_summary_text(&value)))
            }
        }

        deserializer.deserialize_string(BoundedTextVisitor)
    }
}

fn deserialize_summary_content<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    struct SummaryContentVisitor;

    impl<'de> Visitor<'de> for SummaryContentVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("message text or content parts")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
            Ok(bounded_summary_text(value))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
            Ok(bounded_summary_text(&value))
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut text = String::new();
            while let Some(part) = sequence.next_element::<SummaryContentPart>()? {
                if part.kind.as_deref() != Some("text") || part.text.0.is_empty() {
                    continue;
                }
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&part.text.0);
                text = bounded_summary_text(&text);
            }
            Ok(text)
        }

        fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: MapAccess<'de>,
        {
            while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(String::new())
        }

        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(String::new())
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(String::new())
        }

        fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
            Ok(String::new())
        }

        fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
            Ok(String::new())
        }

        fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
            Ok(String::new())
        }

        fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
            Ok(String::new())
        }
    }

    deserializer.deserialize_any(SummaryContentVisitor)
}

fn bounded_summary_text(value: &str) -> String {
    value.chars().take(SUMMARY_TEXT_CHARS).collect()
}

fn json_compaction_message(entry: &Value) -> Value {
    serde_json::json!({
      "role": "compactionSummary",
      "summary": entry.get("summary").and_then(Value::as_str).unwrap_or_default(),
      "tokensBefore": entry.get("tokensBefore").and_then(Value::as_u64).unwrap_or_default(),
      "estimatedTokensAfter": entry.get("estimatedTokensAfter"),
      "timestamp": entry.get("timestamp")
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

fn active_path(entries: &[Value]) -> (Vec<usize>, Option<String>) {
    let by_id = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| Some((entry.get("id")?.as_str()?, index)))
        .collect::<HashMap<_, _>>();
    let leaf_id = entries
        .iter()
        .rev()
        .find_map(|entry| entry.get("id").and_then(Value::as_str).map(str::to_string));
    let mut current = leaf_id.as_deref();
    let mut seen = HashSet::new();
    let mut reversed = Vec::new();
    while let Some(id) = current {
        if !seen.insert(id) {
            break;
        }
        let Some(index) = by_id.get(id).copied() else {
            break;
        };
        reversed.push(index);
        current = entries[index].get("parentId").and_then(Value::as_str);
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

fn sanitize_message(message: &Value) -> Value {
    let mut sanitized = serde_json::Map::new();
    for key in ["role", "stopReason", "errorMessage", "provider", "model"] {
        if let Some(value) = message.get(key).and_then(Value::as_str) {
            sanitized.insert(key.into(), Value::String(value.into()));
        }
    }
    if let Some(content) = message.get("content") {
        let content = match content {
            Value::String(text) => Some(Value::String(text.clone())),
            Value::Array(parts) => Some(Value::Array(
                parts.iter().filter_map(sanitize_content_part).collect(),
            )),
            _ => None,
        };
        if let Some(content) = content {
            sanitized.insert("content".into(), content);
        }
    }
    for key in ["summary", "toolCallId"] {
        if let Some(value) = message.get(key).and_then(Value::as_str) {
            sanitized.insert(key.into(), Value::String(value.into()));
        }
    }
    for key in ["tokensBefore", "estimatedTokensAfter"] {
        if let Some(value) = message.get(key).and_then(Value::as_u64) {
            sanitized.insert(key.into(), Value::Number(value.into()));
        }
    }
    if let Some(details) = message.get("details") {
        sanitized.insert("details".into(), details.clone());
    }
    if message.get("isError").and_then(Value::as_bool) == Some(true) {
        sanitized.insert("isError".into(), Value::Bool(true));
    }
    if message.get("queued").and_then(Value::as_bool) == Some(true) {
        sanitized.insert("queued".into(), Value::Bool(true));
    }
    if let Some(behavior) = message
        .get("streamingBehavior")
        .or_else(|| message.get("deliverAs"))
        .and_then(Value::as_str)
        .filter(|behavior| matches!(*behavior, "steer" | "followUp"))
    {
        sanitized.insert("streamingBehavior".into(), Value::String(behavior.into()));
    }
    Value::Object(sanitized)
}

fn sanitize_content_part(part: &Value) -> Option<Value> {
    let kind = part.get("type").and_then(Value::as_str)?;
    let mut sanitized = serde_json::Map::new();
    sanitized.insert("type".into(), Value::String(kind.into()));
    match kind {
        "text" => {
            sanitized.insert(
                "text".into(),
                Value::String(
                    part.get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .into(),
                ),
            );
        }
        "thinking" => {
            sanitized.insert(
                "thinking".into(),
                Value::String(
                    part.get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .into(),
                ),
            );
            if let Some(label) = part.get("summaryLabel").and_then(Value::as_str) {
                sanitized.insert("summaryLabel".into(), Value::String(label.into()));
            }
        }
        "toolCall" => {
            for key in ["id", "name"] {
                if let Some(value) = part.get(key).and_then(Value::as_str) {
                    sanitized.insert(key.into(), Value::String(value.into()));
                }
            }
            if let Some(arguments) = part.get("arguments") {
                sanitized.insert("arguments".into(), arguments.clone());
            }
        }
        "image" => {
            for key in ["mimeType", "data"] {
                if let Some(value) = part.get(key).and_then(Value::as_str) {
                    sanitized.insert(key.into(), Value::String(value.into()));
                }
            }
        }
        _ => return None,
    }
    Some(Value::Object(sanitized))
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
        assert_eq!(document.active_entry_indices.len(), 2);
        assert_eq!(document.first_user_message(), "first");
        assert_eq!(document.last_message_preview().as_deref(), Some("branch"));
        assert_eq!(document.conversation_items().len(), 2);
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn lightweight_summaries_match_documents_and_invalidate_by_revision() {
        let (directory, path) = fixture(&[
            serde_json::json!({
              "type": "message", "id": "u1", "parentId": null,
              "timestamp": "2026-07-31T00:00:01.000Z",
              "message": {"role": "user", "content": "summarize this session", "timestamp": 1}
            }),
            serde_json::json!({
              "type": "message", "id": "a1", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:02.000Z",
              "message": {"role": "assistant", "content": [{"type":"text","text":"done"}], "provider":"test", "model":"one", "timestamp": 2}
            }),
        ]);
        let store = SessionStore::new(&directory);
        let indexed = index_session_file(&path).expect("index");
        let lightweight = store.summary(&indexed).expect("lightweight summary");
        let document = SessionDocument::load(&path).expect("document");
        let complete = document.summary();
        assert_eq!(lightweight.title, complete.title);
        assert_eq!(
            lightweight.last_message_preview,
            complete.last_message_preview
        );
        assert_eq!(lightweight.message_count, complete.message_count);
        {
            let cache = store.cache.lock().expect("cache");
            assert!(cache.documents.is_empty());
            assert_eq!(cache.summaries.len(), 1);
        }

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open fixture");
        use std::io::Write as _;
        writeln!(
            file,
            "\n{}",
            serde_json::json!({
              "type":"session_info", "id":"n1", "parentId":"a1",
              "timestamp":"2026-07-31T00:00:03.000Z", "name":"Cached name"
            })
        )
        .expect("append name");
        let updated = index_session_file(&path).expect("reindex");
        assert_ne!(updated.revision, indexed.revision);
        assert_eq!(
            store
                .summary(&updated)
                .expect("updated summary")
                .name
                .as_deref(),
            Some("Cached name")
        );
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
