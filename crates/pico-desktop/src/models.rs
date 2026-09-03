use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub enum Patch<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientManifest {
    pub ok: bool,
    pub display_name: String,
    pub version: String,
    pub api_contract_version: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSync {
    #[serde(default)]
    pub session_key: Patch<String>,
    pub items: Option<Vec<ConversationItem>>,
    pub items_patch: Option<ConversationItemsPatch>,
    pub pending_user_messages: Option<Vec<PendingMessage>>,
    #[serde(default)]
    pub context_usage: Patch<Value>,
    pub available_skills: Option<Vec<SkillOption>>,
    pub draft: Option<bool>,
    pub streaming: Option<bool>,
    pub compacting: Option<bool>,
    pub history_offset: Option<usize>,
    pub history_total_count: Option<usize>,
    pub hide_thinking_block: Option<bool>,
    #[serde(default)]
    pub model: Patch<ModelOption>,
    #[serde(default)]
    pub thinking_level: Patch<String>,
    pub available_thinking_levels: Option<Vec<String>>,
    pub available_models: Option<Vec<ModelOption>>,
    #[serde(default)]
    pub session_id: Patch<String>,
    #[serde(default)]
    pub session_file: Patch<String>,
    #[serde(default)]
    pub session_name: Patch<String>,
    #[serde(default)]
    pub first_message: Patch<String>,
    #[serde(default)]
    pub cwd: Patch<String>,
    pub ui_state: Option<SessionUiState>,
}

#[derive(Clone, Debug, Default)]
pub struct SessionState {
    pub session_key: Option<String>,
    pub items: Vec<ConversationItem>,
    pub pending_messages: Vec<PendingMessage>,
    pub context_usage: Option<Value>,
    pub available_skills: Vec<SkillOption>,
    pub draft: bool,
    pub streaming: bool,
    pub compacting: bool,
    pub history_offset: usize,
    pub history_total_count: usize,
    pub hide_thinking_block: bool,
    pub model: Option<ModelOption>,
    pub thinking_level: Option<String>,
    pub available_thinking_levels: Vec<String>,
    pub available_models: Vec<ModelOption>,
    pub session_id: Option<String>,
    pub session_file: Option<String>,
    pub session_name: Option<String>,
    pub first_message: Option<String>,
    pub cwd: Option<String>,
    pub working_message: Option<String>,
}

impl SessionState {
    pub fn apply(&mut self, sync: StateSync) -> bool {
        let mut patch_applied = true;
        let incoming_history_offset = sync.history_offset.unwrap_or(self.history_offset);
        let preserved_history_item_count = sync
            .items_patch
            .as_ref()
            .map(|patch| self.items.len().saturating_sub(patch.previous_length))
            .unwrap_or_else(|| {
                incoming_history_offset
                    .saturating_sub(self.history_offset)
                    .min(self.items.len())
            });
        apply_patch(&mut self.session_key, sync.session_key);
        if let Some(items) = sync.items {
            self.items.splice(preserved_history_item_count.., items);
        }
        if let Some(patch) = sync.items_patch {
            let current_window_length = self
                .items
                .len()
                .saturating_sub(preserved_history_item_count);
            if patch.previous_length == current_window_length {
                let start = preserved_history_item_count + patch.start.min(current_window_length);
                let end = (start + patch.delete_count).min(self.items.len());
                self.items.splice(start..end, patch.items);
            } else {
                patch_applied = false;
            }
        }
        if sync.history_offset.is_some() {
            self.history_offset = if preserved_history_item_count > 0 {
                self.history_offset
            } else {
                incoming_history_offset
            };
        }
        if let Some(value) = sync.history_total_count {
            self.history_total_count = value;
        }
        if let Some(value) = sync.pending_user_messages {
            self.pending_messages = value;
        }
        apply_patch(&mut self.context_usage, sync.context_usage);
        if let Some(value) = sync.available_skills {
            self.available_skills = value;
        }
        if let Some(value) = sync.draft {
            self.draft = value;
        }
        if let Some(value) = sync.streaming {
            self.streaming = value;
        }
        if let Some(value) = sync.compacting {
            self.compacting = value;
        }
        if let Some(value) = sync.hide_thinking_block {
            self.hide_thinking_block = value;
        }
        apply_patch(&mut self.model, sync.model);
        apply_patch(&mut self.thinking_level, sync.thinking_level);
        if let Some(value) = sync.available_thinking_levels {
            self.available_thinking_levels = value;
        }
        if let Some(value) = sync.available_models {
            self.available_models = value;
        }
        apply_patch(&mut self.session_id, sync.session_id);
        apply_patch(&mut self.session_file, sync.session_file);
        apply_patch(&mut self.session_name, sync.session_name);
        apply_patch(&mut self.first_message, sync.first_message);
        apply_patch(&mut self.cwd, sync.cwd);
        if let Some(value) = sync.ui_state {
            self.working_message = value.working_message;
        }
        patch_applied
    }

    pub fn prepend_history(&mut self, response: SessionHistoryResponse) {
        if response.offset >= self.history_offset {
            return;
        }
        self.items.splice(0..0, response.items);
        self.history_offset = response.offset;
        self.history_total_count = response.total_count;
    }

    pub fn apply_delta(&mut self, event: ConversationDeltaEvent) {
        let streaming_index = self
            .items
            .iter()
            .rposition(|item| matches!(item, ConversationItem::Assistant(item) if item.streaming));
        let mut assistant = streaming_index
            .and_then(|index| match self.items.get(index) {
                Some(ConversationItem::Assistant(item)) => Some(item.clone()),
                _ => None,
            })
            .unwrap_or_else(|| AssistantConversationItem {
                item_key: Some("streaming".into()),
                blocks: Vec::new(),
                streaming: true,
                done: false,
                model: None,
            });

        for operation in event.operations {
            match operation {
                ConversationDeltaOperation::ReplaceItem { item } => {
                    assistant = item;
                }
                ConversationDeltaOperation::AppendBlock {
                    content_index,
                    block_key,
                    block_type,
                    delta,
                } => {
                    let block_index = assistant
                        .blocks
                        .iter()
                        .position(|block| block.block_key() == Some(block_key.as_str()));
                    let current = block_index
                        .and_then(|index| assistant.blocks.get(index))
                        .map(AssistantBlock::text)
                        .unwrap_or_default();
                    let block = if block_type == "thinking" {
                        AssistantBlock::Thinking(ThinkingBlock {
                            block_key: Some(block_key),
                            text: format!("{current}{delta}"),
                            summary_label: None,
                        })
                    } else {
                        AssistantBlock::Text(TextBlock {
                            block_key: Some(block_key),
                            text: format!("{current}{delta}"),
                            is_error: false,
                        })
                    };
                    if let Some(index) = block_index {
                        assistant.blocks[index] = block;
                    } else {
                        let index = content_index.min(assistant.blocks.len());
                        assistant.blocks.insert(index, block);
                    }
                }
                ConversationDeltaOperation::ReplaceBlock {
                    content_index,
                    block,
                } => {
                    let block_index = block.block_key().and_then(|key| {
                        assistant
                            .blocks
                            .iter()
                            .position(|candidate| candidate.block_key() == Some(key))
                    });
                    if let Some(index) = block_index {
                        assistant.blocks[index] = block;
                    } else {
                        let index = content_index.min(assistant.blocks.len());
                        assistant.blocks.insert(index, block);
                    }
                }
                ConversationDeltaOperation::UpdateTool {
                    call_id,
                    output,
                    details,
                    is_error,
                    running,
                } => {
                    if let Some(AssistantBlock::Tool(tool)) = assistant.blocks.iter_mut().find(
                        |block| matches!(block, AssistantBlock::Tool(tool) if tool.call_id.as_deref() == Some(&call_id)),
                    ) {
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
                }
            }
        }

        assistant.streaming = true;
        assistant.done = false;
        let item = ConversationItem::Assistant(assistant);
        if let Some(index) = streaming_index {
            self.items[index] = item;
        } else {
            self.items.push(item);
        }
        self.streaming = true;
    }

    pub fn title(&self) -> String {
        self.session_name
            .as_deref()
            .or(self.first_message.as_deref())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("New session")
            .to_string()
    }
}

fn apply_patch<T>(target: &mut Option<T>, patch: Patch<T>) {
    match patch {
        Patch::Missing => {}
        Patch::Null => *target = None,
        Patch::Value(value) => *target = Some(value),
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUiState {
    pub working_message: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationItemsPatch {
    pub previous_length: usize,
    pub start: usize,
    pub delete_count: usize,
    pub items: Vec<ConversationItem>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversationItem {
    User(UserConversationItem),
    Assistant(AssistantConversationItem),
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConversationItem {
    pub item_key: Option<String>,
    pub text: String,
    #[serde(default)]
    pub images: Vec<Value>,
    #[serde(default)]
    pub queued: bool,
    pub streaming_behavior: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantConversationItem {
    pub item_key: Option<String>,
    #[serde(default)]
    pub blocks: Vec<AssistantBlock>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub done: bool,
    pub model: Option<ModelOption>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantBlock {
    Text(TextBlock),
    Thinking(ThinkingBlock),
    Tool(ToolBlock),
    Compaction(CompactionBlock),
}

impl AssistantBlock {
    pub fn block_key(&self) -> Option<&str> {
        match self {
            Self::Text(block) => block.block_key.as_deref(),
            Self::Thinking(block) => block.block_key.as_deref(),
            Self::Tool(block) => block.block_key.as_deref(),
            Self::Compaction(block) => block.block_key.as_deref(),
        }
    }

    pub fn text(&self) -> String {
        match self {
            Self::Text(block) => block.text.clone(),
            Self::Thinking(block) => block.text.clone(),
            Self::Tool(block) => block.output.clone(),
            Self::Compaction(block) => block.summary.clone(),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    pub block_key: Option<String>,
    pub text: String,
    #[serde(default)]
    pub is_error: bool,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingBlock {
    pub block_key: Option<String>,
    #[serde(alias = "thinking")]
    pub text: String,
    pub summary_label: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBlock {
    pub block_key: Option<String>,
    pub call_id: Option<String>,
    pub name: Option<String>,
    pub args: Option<Value>,
    #[serde(default)]
    pub output: String,
    pub details: Option<Value>,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub running: bool,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionBlock {
    pub block_key: Option<String>,
    pub summary: String,
    #[serde(default)]
    pub tokens_before: u64,
    pub estimated_tokens_after: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub provider: Option<String>,
    pub name: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SkillOption {
    pub name: String,
    pub description: Option<String>,
    pub scope: Option<String>,
    pub source: Option<String>,
}

impl ModelOption {
    pub fn label(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.id)
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsEvent {
    pub active_session_id: Option<String>,
    pub active_session_path: Option<String>,
    pub active_session_key: Option<String>,
    #[serde(default)]
    pub directories: Vec<String>,
    #[serde(default)]
    pub directory_indexes: HashMap<String, DirectorySessionsIndex>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySessionsIndex {
    pub directory: String,
    pub total_count: usize,
    #[serde(default)]
    pub sessions: Vec<SessionListEntry>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListEntry {
    pub path: Option<String>,
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub title: String,
    pub last_message_preview: Option<String>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub unread: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDeltaEvent {
    pub session_id: String,
    pub operations: Vec<ConversationDeltaOperation>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ConversationDeltaOperation {
    ReplaceItem {
        item: AssistantConversationItem,
    },
    AppendBlock {
        content_index: usize,
        block_key: String,
        block_type: String,
        delta: String,
    },
    ReplaceBlock {
        content_index: usize,
        block: AssistantBlock,
    },
    UpdateTool {
        call_id: String,
        output: Option<String>,
        details: Option<Value>,
        is_error: Option<bool>,
        running: bool,
    },
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileTreeResponse {
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryResponse {
    pub offset: usize,
    pub total_count: usize,
    pub items: Vec<ConversationItem>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMessage {
    pub pending_id: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<Value>,
    #[serde(default = "default_streaming_behavior")]
    pub streaming_behavior: String,
}

fn default_streaming_behavior() -> String {
    "followUp".into()
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileReadResponse {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResponse {
    pub git_status: Option<GitStatusSummary>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub branch: Option<String>,
    pub detached: bool,
    pub revision: Option<String>,
    pub dirty: bool,
    pub changed_file_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub inline: String,
    pub label: String,
    pub title: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangesResponse {
    #[serde(default)]
    pub files: Option<Vec<GitChangeFile>>,
    #[serde(default)]
    pub local_branches: Option<Vec<GitLocalBranch>>,
    #[serde(default)]
    pub remote_branches: Option<Vec<GitRemoteBranch>>,
    #[serde(default)]
    pub commits: Option<Vec<String>>,
    #[serde(default)]
    pub unpushed_commit_hashes: Option<Vec<String>>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeFile {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
    pub lines_added: Option<usize>,
    pub lines_deleted: Option<usize>,
    pub size_bytes: Option<u64>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLocalBranch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub upstream_gone: bool,
    pub hash: Option<String>,
    pub subject: Option<String>,
    pub relative_date: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteBranch {
    pub name: String,
    pub hash: Option<String>,
    pub subject: Option<String>,
    pub relative_date: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffResponse {
    pub path: String,
    pub patch: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct GitCommitDiffResponse {
    pub commit: String,
    pub title: String,
    pub patch: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResponse {
    pub stdout: String,
    pub stderr: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProvidersResponse {
    #[serde(default)]
    pub oauth_providers: Vec<AuthProvider>,
    #[serde(default)]
    pub api_key_providers: Vec<AuthProvider>,
    #[serde(default)]
    pub logged_in_providers: Vec<AuthProvider>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProvider {
    pub id: String,
    pub name: String,
    pub auth_type: String,
    pub configured: bool,
    pub source: Option<String>,
    pub label: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiRequest {
    pub id: String,
    pub method: String,
    pub title: Option<String>,
    pub message: Option<String>,
    pub placeholder: Option<String>,
    pub prefill: Option<String>,
    pub auth_url: Option<String>,
    #[serde(default)]
    pub auth_manual_allowed: bool,
    #[serde(default)]
    pub allow_empty: bool,
    #[serde(default)]
    pub options: Vec<UiRequestOption>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TerminalCreateResponse {
    pub id: String,
    pub cwd: String,
    pub shell: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSettings {
    pub transport: String,
    pub cache_retention: String,
    #[serde(default)]
    pub applies_to_active_session_after_restart: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub session_id: Option<String>,
    pub session_path: Option<String>,
    pub streaming: Option<bool>,
    pub unread: Option<bool>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDone {
    pub id: String,
    pub session_id: Option<String>,
    pub session_path: Option<String>,
    pub title: Option<String>,
    pub reason: String,
    pub outcome: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTreeResponse {
    pub leaf_id: Option<String>,
    #[serde(default)]
    pub tree: Vec<TreeNode>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TreeNode {
    pub entry: TreeEntry,
    pub label: Option<String>,
    #[serde(default)]
    pub children: Vec<TreeNode>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub message: Option<TreeMessage>,
    pub custom_type: Option<String>,
    pub text: Option<String>,
    pub summary: Option<String>,
    pub model_id: Option<String>,
    pub thinking_level: Option<String>,
    pub name: Option<String>,
    pub label: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Default, Deserialize)]
pub struct TreeMessage {
    pub role: Option<String>,
    pub text: Option<String>,
    pub command: Option<String>,
}

impl TreeNode {
    pub fn flatten(&self, depth: usize, output: &mut Vec<FlatTreeNode>) {
        let message_text = self
            .entry
            .message
            .as_ref()
            .and_then(|message| message.text.as_ref().or(message.command.as_ref()).cloned());
        let text = self
            .label
            .as_ref()
            .cloned()
            .or(message_text.clone())
            .or(self.entry.summary.clone())
            .or(self.entry.text.clone())
            .or(self.entry.model_id.clone())
            .or(self.entry.thinking_level.clone())
            .or(self.entry.name.clone())
            .or(self.entry.label.clone())
            .or(self.entry.custom_type.clone())
            .unwrap_or_else(|| match self.entry.entry_type.as_str() {
                "branch_summary" => "Branch summary".into(),
                "compaction" => "Compaction event".into(),
                "message" => "Message".into(),
                "model_change" => "Model changed".into(),
                "thinking_level_change" => "Thinking level changed".into(),
                "session_info" => "Session title".into(),
                other => other.replace('_', " "),
            });
        let visible_by_default = match self.entry.entry_type.as_str() {
            "label" | "custom" | "model_change" | "thinking_level_change" | "session_info" => false,
            "message" => message_text.is_some(),
            _ => true,
        };
        output.push(FlatTreeNode {
            id: self.entry.id.clone(),
            depth,
            text,
            visible_by_default,
        });
        for child in &self.children {
            child.flatten(depth + 1, output);
        }
    }
}

#[derive(Clone, Debug)]
pub struct FlatTreeNode {
    pub id: String,
    pub depth: usize,
    pub text: String,
    pub visible_by_default: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ForkableMessagesResponse {
    #[serde(default)]
    pub messages: Vec<ForkableMessage>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkableMessage {
    pub entry_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum UiRequestOption {
    Text(String),
    Item {
        value: String,
        label: Option<String>,
    },
}

impl UiRequestOption {
    pub fn value(&self) -> &str {
        match self {
            Self::Text(value) | Self::Item { value, .. } => value,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Text(value) => value,
            Self::Item { value, label } => label.as_deref().unwrap_or(value),
        }
    }
}

#[derive(Clone, Debug)]
pub enum DesktopEvent {
    Connected(ClientManifest),
    ConnectionChanged(bool),
    State(StateSync),
    History {
        session_id: String,
        response: SessionHistoryResponse,
    },
    Sessions(SessionsEvent),
    Delta(ConversationDeltaEvent),
    Files {
        cwd: String,
        paths: Vec<String>,
    },
    WorkspaceUnavailable {
        cwd: String,
        error: String,
    },
    FileRead {
        cwd: String,
        response: ProjectFileReadResponse,
    },
    GitStatus {
        cwd: String,
        status: Option<GitStatusSummary>,
    },
    GitChanges {
        cwd: String,
        response: GitChangesResponse,
    },
    GitDiff {
        cwd: String,
        response: GitFileDiffResponse,
    },
    GitCommitDiff {
        cwd: String,
        response: GitCommitDiffResponse,
    },
    GitMutation(String),
    GitRefresh(String),
    PendingMessages(Vec<PendingMessage>),
    AuthProviders(AuthProvidersResponse),
    AuthChanged(String),
    UiRequest(UiRequest),
    UiRequestResolved,
    Notification(String),
    TerminalCreated(TerminalCreateResponse),
    TerminalOutput(String),
    SessionTree(SessionTreeResponse),
    ForkableMessages(Vec<ForkableMessage>),
    CommitMessage(String),
    PerformanceSettings(PerformanceSettings),
    SessionStatus(SessionStatus),
    SessionDone(SessionDone),
    PromptSent,
    PromptAcknowledged,
    SessionCreated {
        session_key: String,
        cwd: String,
    },
    SessionSelected(String),
    DirectoryResolved(String),
    SessionAction {
        message: String,
        clear_selection: bool,
    },
    SessionMoved {
        path: String,
        cwd: String,
    },
    ModelChanged(ModelOption),
    ThinkingChanged(String),
    Error(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest<'a> {
    pub message: &'a str,
    pub images: Vec<Value>,
    pub streaming_behavior: &'a str,
    pub draft_owner_key: Option<&'a str>,
    pub draft_cwd: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_tree_uses_readable_labels_and_hides_settings_entries() {
        let tree: TreeNode = serde_json::from_value(serde_json::json!({
            "entry": {
                "id": "model",
                "type": "model_change",
                "modelId": "anthropic/claude"
            },
            "children": [{
                "entry": {
                    "id": "message",
                    "type": "message",
                    "message": { "role": "user", "text": "Review this change" }
                },
                "children": []
            }]
        }))
        .unwrap();
        let mut nodes = Vec::new();

        tree.flatten(0, &mut nodes);

        assert_eq!(nodes[0].text, "anthropic/claude");
        assert!(!nodes[0].visible_by_default);
        assert_eq!(nodes[1].text, "Review this change");
        assert!(nodes[1].visible_by_default);
    }

    #[test]
    fn state_sync_patch_replaces_the_streaming_item() {
        let initial: StateSync = serde_json::from_str(include_str!(
            "../../../apps/apple/Fixtures/state_sync_initial.json"
        ))
        .unwrap();
        let patch: StateSync = serde_json::from_str(include_str!(
            "../../../apps/apple/Fixtures/state_sync_patch.json"
        ))
        .unwrap();
        let mut state = SessionState::default();

        state.apply(initial);
        state.apply(patch);

        assert_eq!(state.items.len(), 2);
        let ConversationItem::Assistant(assistant) = &state.items[1] else {
            panic!("expected assistant item");
        };
        assert!(!assistant.streaming);
        assert_eq!(
            assistant.blocks[0].text(),
            "The native client skeleton is ready."
        );
    }

    #[test]
    fn conversation_delta_appends_streaming_text() {
        let mut state = SessionState::default();
        let event: ConversationDeltaEvent = serde_json::from_value(serde_json::json!({
            "sessionId": "demo",
            "operations": [{
                "op": "appendBlock",
                "contentIndex": 0,
                "blockKey": "text-1",
                "blockType": "text",
                "delta": "Hello from GPUI"
            }]
        }))
        .unwrap();

        state.apply_delta(event);

        assert!(state.streaming);
        let ConversationItem::Assistant(assistant) = &state.items[0] else {
            panic!("expected assistant item");
        };
        assert_eq!(assistant.blocks[0].text(), "Hello from GPUI");
    }

    #[test]
    fn state_sync_distinguishes_missing_and_null_fields() {
        let mut state = SessionState {
            session_name: Some("Old name".into()),
            cwd: Some("/old".into()),
            model: Some(ModelOption {
                id: "old-model".into(),
                provider: Some("provider".into()),
                name: None,
            }),
            ..SessionState::default()
        };
        let missing: StateSync = serde_json::from_value(serde_json::json!({
            "type": "state_sync",
            "streaming": false
        }))
        .unwrap();
        let nulls: StateSync = serde_json::from_value(serde_json::json!({
            "type": "state_sync",
            "sessionName": null,
            "cwd": null,
            "model": null
        }))
        .unwrap();

        assert!(state.apply(missing));
        assert_eq!(state.session_name.as_deref(), Some("Old name"));
        assert!(state.apply(nulls));
        assert!(state.session_name.is_none());
        assert!(state.cwd.is_none());
        assert!(state.model.is_none());
    }

    #[test]
    fn state_sync_reports_patch_length_mismatch() {
        let mut state = SessionState::default();
        let patch: StateSync = serde_json::from_value(serde_json::json!({
            "type": "state_sync",
            "itemsPatch": {
                "previousLength": 1,
                "start": 0,
                "deleteCount": 0,
                "items": []
            }
        }))
        .unwrap();

        assert!(!state.apply(patch));
    }

    #[test]
    fn state_sync_patch_preserves_pages_loaded_before_the_live_window() {
        let mut state = SessionState {
            items: serde_json::from_value(serde_json::json!([
                {"kind":"user","itemKey":"old","text":"Older","images":[]},
                {"kind":"user","itemKey":"current","text":"Current","images":[]},
                {"kind":"assistant","itemKey":"answer","blocks":[],"streaming":true}
            ]))
            .unwrap(),
            history_offset: 49,
            history_total_count: 51,
            ..SessionState::default()
        };
        let patch: StateSync = serde_json::from_value(serde_json::json!({
            "type": "state_sync",
            "itemsPatch": {
                "previousLength": 2,
                "start": 1,
                "deleteCount": 1,
                "items": [{
                    "kind":"assistant", "itemKey":"answer", "blocks":[], "streaming":false
                }]
            }
        }))
        .unwrap();

        assert!(state.apply(patch));
        assert_eq!(state.items.len(), 3);
        let ConversationItem::User(oldest) = &state.items[0] else {
            panic!("expected preserved user item");
        };
        assert_eq!(oldest.item_key.as_deref(), Some("old"));
        let ConversationItem::Assistant(answer) = &state.items[2] else {
            panic!("expected patched assistant item");
        };
        assert!(!answer.streaming);
    }
}
