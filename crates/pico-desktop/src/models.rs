use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub session_key: Option<String>,
    pub items: Option<Vec<ConversationItem>>,
    pub items_patch: Option<ConversationItemsPatch>,
    pub pending_user_messages: Option<Vec<PendingMessage>>,
    pub draft: Option<bool>,
    pub streaming: Option<bool>,
    pub compacting: Option<bool>,
    pub hide_thinking_block: Option<bool>,
    pub model: Option<ModelOption>,
    pub thinking_level: Option<String>,
    pub available_thinking_levels: Option<Vec<String>>,
    pub available_models: Option<Vec<ModelOption>>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub first_message: Option<String>,
    pub cwd: Option<String>,
    pub ui_state: Option<SessionUiState>,
}

#[derive(Clone, Debug, Default)]
pub struct SessionState {
    pub session_key: Option<String>,
    pub items: Vec<ConversationItem>,
    pub pending_messages: Vec<PendingMessage>,
    pub draft: bool,
    pub streaming: bool,
    pub compacting: bool,
    pub hide_thinking_block: bool,
    pub model: Option<ModelOption>,
    pub thinking_level: Option<String>,
    pub available_thinking_levels: Vec<String>,
    pub available_models: Vec<ModelOption>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub first_message: Option<String>,
    pub cwd: Option<String>,
    pub working_message: Option<String>,
}

impl SessionState {
    pub fn apply(&mut self, sync: StateSync) {
        if let Some(value) = sync.session_key {
            self.session_key = Some(value);
        }
        if let Some(items) = sync.items {
            self.items = items;
        }
        if let Some(patch) = sync.items_patch
            && patch.previous_length == self.items.len()
        {
            let start = patch.start.min(self.items.len());
            let end = (start + patch.delete_count).min(self.items.len());
            self.items.splice(start..end, patch.items);
        }
        if let Some(value) = sync.pending_user_messages {
            self.pending_messages = value;
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
        if let Some(value) = sync.model {
            self.model = Some(value);
        }
        if let Some(value) = sync.thinking_level {
            self.thinking_level = Some(value);
        }
        if let Some(value) = sync.available_thinking_levels {
            self.available_thinking_levels = value;
        }
        if let Some(value) = sync.available_models {
            self.available_models = value;
        }
        if let Some(value) = sync.session_id {
            self.session_id = Some(value);
        }
        if let Some(value) = sync.session_name {
            self.session_name = Some(value);
        }
        if let Some(value) = sync.first_message {
            self.first_message = Some(value);
        }
        if let Some(value) = sync.cwd {
            self.cwd = Some(value);
        }
        if let Some(value) = sync.ui_state {
            self.working_message = value.working_message;
        }
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
    State(StateSync),
    Sessions(SessionsEvent),
    Delta(ConversationDeltaEvent),
    Files(Vec<String>),
    FileRead(ProjectFileReadResponse),
    GitStatus(Option<GitStatusSummary>),
    GitChanges(GitChangesResponse),
    GitDiff(GitFileDiffResponse),
    GitMutation(String),
    GitRefresh(String),
    PendingMessages(Vec<PendingMessage>),
    AuthProviders(AuthProvidersResponse),
    AuthChanged(String),
    UiRequest(UiRequest),
    UiRequestResolved,
    PromptSent,
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
}
