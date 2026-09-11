use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::protocol::{
    AssistantBlock, AssistantConversationItem, CompactionBlock, ConversationItem, ModelOption,
    PromptImage, SessionListEntry, TextBlock, ThinkingBlock, ToolBlock, UserConversationItem,
};

const MAX_SESSION_HEADER_BYTES: usize = 1024 * 1024;
const MAX_SESSION_ENTRY_BYTES: usize = 16 * 1024 * 1024;
const MAX_SESSION_COUNT: usize = 20_000;
const MAX_CACHED_DOCUMENTS: usize = 4;
const MAX_CACHED_DOCUMENT_SOURCE_BYTES: u64 = 96 * 1024 * 1024;

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
    entry_index: Vec<SessionEntryIndex>,
    active_entry_indices: Vec<usize>,
    pub leaf_id: Option<String>,
    pub modified: Option<String>,
    revision: String,
}

#[derive(Debug)]
struct SessionEntryIndex {
    offset: u64,
    kind: Option<String>,
    id: Option<String>,
    parent_id: Option<String>,
    message_role: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionEntryIndexRecord {
    #[serde(rename = "type")]
    kind: Option<String>,
    id: Option<String>,
    parent_id: Option<String>,
    message: Option<SessionEntryIndexMessage>,
}

#[derive(Debug, Deserialize)]
struct SessionEntryIndexMessage {
    role: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ConversationPage {
    pub items: Vec<ConversationItem>,
    pub offset: usize,
    pub total_count: usize,
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

#[derive(Debug, Clone)]
pub struct IndexedSessionFile {
    pub path: PathBuf,
    pub header: SessionHeader,
    pub modified: Option<String>,
    pub revision: String,
}

impl SessionStore {
    pub fn new(agent_dir: &Path) -> Self {
        Self::from_root(agent_dir.join("sessions"))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            root,
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
        let cached_document = {
            let cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(cached) = cache.summaries.get(&indexed.path) {
                if cached.revision == indexed.revision {
                    return Ok(cached.summary.clone());
                }
            }
            cache
                .documents
                .get(&indexed.path)
                .filter(|cached| cached.revision == indexed.revision)
                .map(|cached| cached.document.clone())
        };
        let summary = match cached_document {
            Some(document) => document.summary(),
            None => load_session_summary(indexed)?,
        };
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
        let entry_index = read_session_entry_index(&mut reader, path)?;
        let (active_entry_indices, leaf_id) = active_index_path(&entry_index);
        Ok(Self {
            path: path.to_path_buf(),
            header,
            entry_index,
            active_entry_indices,
            leaf_id,
            modified: metadata.modified().ok().and_then(format_system_time),
            revision,
        })
    }

    fn active_entries(&self) -> impl DoubleEndedIterator<Item = &SessionEntryIndex> {
        self.active_entry_indices
            .iter()
            .filter_map(|index| self.entry_index.get(*index))
    }

    fn read_entry(&self, entry: &SessionEntryIndex) -> Option<Value> {
        match read_session_entry_at(&self.path, entry.offset) {
            Ok(value) => Some(value),
            Err(error) => {
                tracing::warn!(
                    %error,
                    path = %self.path.display(),
                    offset = entry.offset,
                    "failed to read indexed Pi session entry"
                );
                None
            }
        }
    }

    fn read_entries<'a>(
        &self,
        entries: impl IntoIterator<Item = &'a SessionEntryIndex>,
    ) -> Vec<Value> {
        let mut reader = match std::fs::File::open(&self.path).map(io::BufReader::new) {
            Ok(reader) => reader,
            Err(error) => {
                tracing::warn!(
                    %error,
                    path = %self.path.display(),
                    "failed to open indexed Pi session"
                );
                return Vec::new();
            }
        };
        entries
            .into_iter()
            .filter_map(|entry| {
                read_session_entry_from_reader(&mut reader, entry.offset)
                    .map_err(|error| {
                        tracing::warn!(
                            %error,
                            path = %self.path.display(),
                            offset = entry.offset,
                            "failed to read indexed Pi session entry"
                        );
                    })
                    .ok()
            })
            .collect()
    }

    pub fn contains_entry_id(&self, id: &str) -> bool {
        self.entry_index
            .iter()
            .any(|entry| entry.id.as_deref() == Some(id))
    }

    pub fn tree_json(&self, streaming: bool) -> io::Result<Vec<u8>> {
        let mut reader = io::BufReader::new(std::fs::File::open(&self.path)?);
        crate::session_tree::serialize_tree(
            self.entry_index
                .iter()
                .map(|entry| read_session_entry_from_reader(&mut reader, entry.offset)),
            self.leaf_id.as_deref(),
            streaming,
        )
    }

    pub fn session_name(&self) -> Option<String> {
        self.active_entries().rev().find_map(|entry| {
            (entry.kind.as_deref() == Some("session_info"))
                .then(|| self.read_entry(entry))
                .flatten()
                .and_then(|entry| {
                    entry
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
        })
    }

    pub fn first_user_message(&self) -> String {
        self.active_entries()
            .find(|entry| {
                entry.kind.as_deref() == Some("message")
                    && entry.message_role.as_deref() == Some("user")
            })
            .and_then(|entry| self.read_entry(entry))
            .and_then(|entry| message_with_role(&entry, "user").map(message_text))
            .unwrap_or_default()
    }

    pub fn last_message_preview(&self) -> Option<String> {
        self.active_entries().rev().find_map(|indexed| {
            if indexed.kind.as_deref() != Some("message")
                || !matches!(indexed.message_role.as_deref(), Some("user" | "assistant"))
            {
                return None;
            }
            let entry = self.read_entry(indexed)?;
            let message = entry.get("message")?;
            let role = message.get("role").and_then(Value::as_str)?;
            matches!(role, "user" | "assistant")
                .then(|| truncate_preview(&message_text(message), 160))
                .filter(|preview| !preview.is_empty())
        })
    }

    pub fn message_count(&self) -> usize {
        self.active_entries()
            .filter(|entry| entry.kind.as_deref() == Some("message"))
            .count()
    }

    pub fn model(&self) -> Option<ModelOption> {
        for indexed in self.active_entries().rev() {
            if indexed.kind.as_deref() == Some("model_change") {
                let entry = self.read_entry(indexed)?;
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
            if indexed.kind.as_deref() == Some("message")
                && indexed.message_role.as_deref() == Some("assistant")
            {
                let entry = self.read_entry(indexed)?;
                let Some(message) = message_with_role(&entry, "assistant") else {
                    continue;
                };
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
        self.active_entries().rev().find_map(|indexed| {
            (indexed.kind.as_deref() == Some("thinking_level_change"))
                .then(|| self.read_entry(indexed))
                .flatten()
                .and_then(|entry| {
                    entry
                        .get("thinkingLevel")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
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
            last_message_at: self.active_entries().rev().find_map(|indexed| {
                self.read_entry(indexed)?
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
        self.read_entries(self.active_entries())
            .iter()
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
        let entries = self.read_entries(self.active_entries());
        conversation_items_for_entries(entries.iter())
    }

    pub fn conversation_page(&self, before: Option<usize>, limit: usize) -> ConversationPage {
        let active_indices = &self.active_entry_indices;
        let item_starts = active_indices
            .iter()
            .enumerate()
            .filter_map(|(active_position, entry_index)| {
                conversation_item_starts_index(&self.entry_index[*entry_index])
                    .then_some(active_position)
            })
            .collect::<Vec<_>>();
        let total_count = item_starts.len();
        let before = before.unwrap_or(total_count).min(total_count);
        let offset = before.saturating_sub(limit);
        let start_position = item_starts
            .get(offset)
            .copied()
            .unwrap_or(active_indices.len());
        let end_position = item_starts
            .get(before)
            .copied()
            .unwrap_or(active_indices.len());
        let entries = self.read_entries(
            active_indices[start_position..end_position]
                .iter()
                .filter_map(|index| self.entry_index.get(*index)),
        );
        let items = conversation_items_for_entries(entries.iter());

        ConversationPage {
            items,
            offset,
            total_count,
        }
    }

    pub fn revision(&self) -> String {
        format!("{}:{}", self.entry_index.len(), self.revision)
    }
}

fn conversation_item_starts_index(entry: &SessionEntryIndex) -> bool {
    match entry.kind.as_deref() {
        Some("message") => matches!(entry.message_role.as_deref(), Some("user" | "assistant")),
        Some("compaction") => true,
        _ => false,
    }
}

pub fn conversation_items_from_entries(
    entries: &[Value],
    leaf_id: Option<&str>,
) -> Vec<ConversationItem> {
    let (indices, _) = active_path_from(entries, leaf_id);
    conversation_items_for_entries(indices.iter().filter_map(|index| entries.get(*index)))
}

fn conversation_items_for_entries<'a>(
    entries: impl IntoIterator<Item = &'a Value>,
) -> Vec<ConversationItem> {
    let mut items = Vec::new();
    let mut tools = HashMap::<String, (usize, usize)>::new();
    for entry in entries {
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
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Pi session path is not a regular file",
        ));
    }
    Ok(metadata)
}

fn read_session_header(reader: &mut impl BufRead) -> io::Result<SessionHeader> {
    let mut header_line = String::new();
    if read_bounded_line(reader, &mut header_line, MAX_SESSION_HEADER_BYTES)? == 0 {
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

fn read_session_entry_index(
    reader: &mut (impl BufRead + Seek),
    path: &Path,
) -> io::Result<Vec<SessionEntryIndex>> {
    let mut entries = Vec::new();
    let mut line = String::new();
    let mut trailing_error = None;
    loop {
        let offset = reader.stream_position()?;
        line.clear();
        if read_bounded_line(reader, &mut line, MAX_SESSION_ENTRY_BYTES)? == 0 {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Some(error) = trailing_error.take() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, error));
        }
        match serde_json::from_str::<SessionEntryIndexRecord>(&line) {
            Ok(entry) => entries.push(SessionEntryIndex {
                offset,
                kind: entry.kind,
                id: entry.id,
                parent_id: entry.parent_id,
                message_role: entry.message.and_then(|message| message.role),
            }),
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
    Ok(entries)
}

fn read_session_entry_at(path: &Path, offset: u64) -> io::Result<Value> {
    let file = std::fs::File::open(path)?;
    read_session_entry_from_reader(&mut io::BufReader::new(file), offset)
}

fn read_session_entry_from_reader(
    reader: &mut (impl BufRead + Seek),
    offset: u64,
) -> io::Result<Value> {
    reader.seek(SeekFrom::Start(offset))?;
    let mut line = String::new();
    if read_bounded_line(reader, &mut line, MAX_SESSION_ENTRY_BYTES)? == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "indexed Pi session entry is missing",
        ));
    }
    let mut entry = serde_json::from_str(&line)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    compact_session_entry(&mut entry);
    Ok(entry)
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    line: &mut String,
    max_bytes: usize,
) -> io::Result<usize> {
    let mut limited = std::io::Read::take(reader, max_bytes.saturating_add(1) as u64);
    let bytes_read = limited.read_line(line)?;
    if bytes_read > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Pi session JSONL entry exceeds the {max_bytes}-byte limit"),
        ));
    }
    Ok(bytes_read)
}

fn compact_session_entry(entry: &mut Value) {
    let Some(message) = entry.get_mut("message").and_then(Value::as_object_mut) else {
        return;
    };
    if message.get("role").and_then(Value::as_str) != Some("toolResult") {
        return;
    }

    let Some(parts) = message.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    parts.retain(|part| part.get("type").and_then(Value::as_str) != Some("image"));
}

fn load_session_summary(indexed: &IndexedSessionFile) -> io::Result<SessionListEntry> {
    let metadata = supported_session_metadata(&indexed.path)?;
    SessionDocument::load_with_metadata(&indexed.path, metadata, indexed.revision.clone())
        .map(|document| document.summary())
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

fn active_index_path(entries: &[SessionEntryIndex]) -> (Vec<usize>, Option<String>) {
    let leaf_id = entries.iter().rev().find_map(|entry| entry.id.clone());
    let by_id = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| Some((entry.id.as_deref()?, index)))
        .collect::<HashMap<_, _>>();
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
        current = entries[index].parent_id.as_deref();
    }
    reversed.reverse();
    (reversed, leaf_id)
}

fn active_path_from(entries: &[Value], leaf_id: Option<&str>) -> (Vec<usize>, Option<String>) {
    let by_id = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| Some((entry.get("id")?.as_str()?, index)))
        .collect::<HashMap<_, _>>();
    let mut current = leaf_id;
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
    (reversed, leaf_id.map(str::to_string))
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
        let entries = vec![
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
        ];
        let (directory, path) = fixture(&entries);
        let document = SessionDocument::load(&path).expect("load");
        assert_eq!(document.leaf_id.as_deref(), Some("u2"));
        assert_eq!(document.active_entry_indices.len(), 2);
        assert_eq!(document.first_user_message(), "first");
        assert_eq!(document.last_message_preview().as_deref(), Some("branch"));
        assert_eq!(document.conversation_items().len(), 2);
        let older_branch = conversation_items_from_entries(&entries, Some("a1"));
        assert_eq!(older_branch.len(), 2);
        let ConversationItem::Assistant(assistant) = &older_branch[1] else {
            panic!("expected assistant on selected durable branch");
        };
        let AssistantBlock::Text(text) = &assistant.blocks[0] else {
            panic!("expected assistant text");
        };
        assert_eq!(text.text, "old");
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

    #[test]
    fn conversation_pages_keep_tool_results_with_their_assistant() {
        let (directory, path) = fixture(&[
            serde_json::json!({
              "type": "message", "id": "u1", "parentId": null,
              "timestamp": "2026-07-31T00:00:01.000Z",
              "message": {"role":"user","content":"first","timestamp":1}
            }),
            serde_json::json!({
              "type": "message", "id": "a1", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:02.000Z",
              "message": {"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"README.md"}}],"timestamp":2}
            }),
            serde_json::json!({
              "type": "message", "id": "t1", "parentId": "a1",
              "timestamp": "2026-07-31T00:00:03.000Z",
              "message": {"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"# Hello"}],"isError":false,"timestamp":3}
            }),
            serde_json::json!({
              "type": "message", "id": "u2", "parentId": "t1",
              "timestamp": "2026-07-31T00:00:04.000Z",
              "message": {"role":"user","content":"second","timestamp":4}
            }),
            serde_json::json!({
              "type": "message", "id": "a2", "parentId": "u2",
              "timestamp": "2026-07-31T00:00:05.000Z",
              "message": {"role":"assistant","content":[{"type":"text","text":"done"}],"timestamp":5}
            }),
        ]);
        let document = SessionDocument::load(&path).expect("load");

        let assistant_page = document.conversation_page(Some(2), 1);
        assert_eq!(assistant_page.offset, 1);
        assert_eq!(assistant_page.total_count, 4);
        let ConversationItem::Assistant(assistant) = &assistant_page.items[0] else {
            panic!("expected assistant");
        };
        let AssistantBlock::Tool(tool) = &assistant.blocks[0] else {
            panic!("expected tool");
        };
        assert_eq!(tool.output, "# Hello");

        let latest_page = document.conversation_page(None, 2);
        assert_eq!(latest_page.offset, 2);
        assert_eq!(latest_page.total_count, 4);
        assert_eq!(latest_page.items.len(), 2);
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn indexing_accepts_large_regular_session_files() {
        let (directory, path) = fixture(&[]);
        use std::io::Write as _;
        let mut append = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open fixture for newline");
        writeln!(append).expect("terminate header line");
        drop(append);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open fixture");
        file.set_len(64 * 1024 * 1024 + 1)
            .expect("extend fixture past the former total-size limit");

        let indexed = index_session_file(&path).expect("index large session header");
        assert_eq!(indexed.header.id, "session-1");
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn document_discards_tool_result_images_but_keeps_text() {
        let (directory, path) = fixture(&[
            serde_json::json!({
              "type": "message", "id": "u1", "parentId": null,
              "timestamp": "2026-07-31T00:00:01.000Z",
              "message": {"role": "user", "content": "inspect", "timestamp": 1}
            }),
            serde_json::json!({
              "type": "message", "id": "a1", "parentId": "u1",
              "timestamp": "2026-07-31T00:00:02.000Z",
              "message": {"role": "assistant", "content": [{"type":"toolCall","id":"call-1","name":"view_image","arguments":{"path":"image.png"}}], "provider":"test", "model":"one", "stopReason":"toolUse", "timestamp":2}
            }),
            serde_json::json!({
              "type": "message", "id": "t1", "parentId": "a1",
              "timestamp": "2026-07-31T00:00:03.000Z",
              "message": {"role":"toolResult","toolCallId":"call-1","toolName":"view_image","content":[{"type":"image","mimeType":"image/png","data":"large-base64-payload"},{"type":"text","text":"Image Size: 10x10"}],"details":{"viewImage":true},"isError":false,"timestamp":3}
            }),
        ]);

        let document = SessionDocument::load(&path).expect("load");
        let tool_result_entry = document
            .active_entries()
            .find(|entry| entry.message_role.as_deref() == Some("toolResult"))
            .expect("tool result index");
        let tool_result_entry = document
            .read_entry(tool_result_entry)
            .expect("read tool result");
        let tool_result = message_with_role(&tool_result_entry, "toolResult").expect("tool result");
        let content = tool_result["content"].as_array().expect("content array");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");

        let items = document.conversation_items();
        let ConversationItem::Assistant(assistant) = &items[1] else {
            panic!("expected assistant");
        };
        let AssistantBlock::Tool(tool) = &assistant.blocks[0] else {
            panic!("expected tool");
        };
        assert_eq!(tool.output, "Image Size: 10x10");
        std::fs::remove_dir_all(directory).expect("remove fixture");
    }
}
