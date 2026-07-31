use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const API_CONTRACT_VERSION: u32 = 1;
pub const SERVER_PROTOCOL_VERSION: u32 = 2;
pub const PERSISTENCE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientManifest {
    pub ok: bool,
    pub name: String,
    pub version: String,
    pub display_name: String,
    pub server_protocol_version: u32,
    pub api_contract_version: u32,
    pub pairing_required: bool,
    pub authentication: AuthenticationManifest,
    pub transport: TransportManifest,
    pub capabilities: CapabilityManifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticationManifest {
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportManifest {
    pub sse: bool,
    pub https_required: bool,
    pub local_http_allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityManifest {
    pub events: Vec<String>,
    pub endpoints: Vec<String>,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSync {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<ConversationItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_patch: Option<ConversationItemsPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub messages: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_user_messages: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compacting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming_message: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_offset: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_total_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_usage: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_thinking_block: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_thinking_levels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_models: Option<Vec<ModelOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_skills: Option<Vec<SkillOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_file: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_state: Option<SessionUiState>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillOption {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversationItem {
    User(UserConversationItem),
    Assistant(AssistantConversationItem),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConversationItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_entry_id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub images: Vec<PromptImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming_behavior: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptImage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub mime_type: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantConversationItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_entry_id: Option<String>,
    pub blocks: Vec<AssistantBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantBlock {
    Text(TextBlock),
    Thinking(ThinkingBlock),
    Tool(ToolBlock),
    Compaction(CompactionBlock),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingBlock {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    #[serde(alias = "thinking")]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBlock {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub output: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    pub is_error: bool,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionBlock {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_key: Option<String>,
    pub summary: String,
    pub tokens_before: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_tokens_after: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationItemsPatch {
    pub previous_length: usize,
    pub start: usize,
    pub delete_count: usize,
    pub items: Vec<ConversationItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUiState {
    #[serde(default)]
    pub statuses: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_key: Option<String>,
    #[serde(default)]
    pub directories: Vec<PathBuf>,
    #[serde(default)]
    pub directory_states: Vec<DirectoryState>,
    #[serde(default)]
    pub directory_indexes: HashMap<String, DirectorySessionsIndex>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryState {
    pub path: PathBuf,
    pub total_count: usize,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySessionsIndex {
    pub directory: PathBuf,
    pub total_count: usize,
    pub revision: String,
    pub sessions: Vec<SessionListEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_message_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_usage: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optimistic: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PiRpcEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PicoEventEnvelope {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResponse {
    pub ok: bool,
    pub cwd: PathBuf,
    pub git_status: Option<GitStatusSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub detached: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub dirty: bool,
    pub changed_file_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub inline: String,
    pub label: String,
    pub title: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/apple/Fixtures");

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(FIXTURES).join(name);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
    }

    fn assert_value_round_trip<T>(name: &str)
    where
        T: for<'de> Deserialize<'de> + Serialize,
    {
        let expected: Value = serde_json::from_str(&fixture(name)).expect("fixture JSON");
        let decoded: T = serde_json::from_value(expected.clone()).expect("decode fixture");
        let actual = serde_json::to_value(decoded).expect("encode fixture");
        assert_eq!(actual, expected, "fixture {name} changed during round trip");
    }

    #[test]
    fn manifest_round_trips() {
        assert_value_round_trip::<ClientManifest>("client_manifest.json");
    }

    #[test]
    fn initial_state_sync_round_trips() {
        assert_value_round_trip::<StateSync>("state_sync_initial.json");
    }

    #[test]
    fn patch_state_sync_round_trips() {
        assert_value_round_trip::<StateSync>("state_sync_patch.json");
    }

    #[test]
    fn sessions_event_round_trips() {
        assert_value_round_trip::<SessionsEvent>("sessions_event.json");
    }

    #[test]
    fn pi_rpc_events_round_trip() {
        let expected: Value =
            serde_json::from_str(&fixture("pi_rpc_events.json")).expect("fixture");
        let decoded: Vec<PiRpcEvent> =
            serde_json::from_value(expected.clone()).expect("decode events");
        assert_eq!(
            serde_json::to_value(decoded).expect("encode events"),
            expected
        );
    }

    #[test]
    fn pico_events_round_trip() {
        let expected: Value = serde_json::from_str(&fixture("pico_events.json")).expect("fixture");
        let decoded: Vec<PicoEventEnvelope> =
            serde_json::from_value(expected.clone()).expect("decode events");
        assert_eq!(
            serde_json::to_value(decoded).expect("encode events"),
            expected
        );
    }

    #[test]
    fn terminal_events_round_trip() {
        let expected: Value =
            serde_json::from_str(&fixture("terminal_events.json")).expect("fixture");
        let decoded: Vec<TerminalEvent> =
            serde_json::from_value(expected.clone()).expect("decode events");
        assert_eq!(
            serde_json::to_value(decoded).expect("encode events"),
            expected
        );
    }

    #[test]
    fn representative_api_responses_are_valid_json_objects() {
        let expected: Value =
            serde_json::from_str(&fixture("api_responses.json")).expect("fixture");
        let responses = expected.as_object().expect("response fixture map");
        assert!(responses.len() >= 10);
        assert!(responses.values().all(Value::is_object));
    }

    #[test]
    fn route_inventory_covers_the_server_surface() {
        let routes: Vec<Value> =
            serde_json::from_str(&fixture("route_inventory.json")).expect("fixture");
        assert!(routes.len() >= 60);
        assert!(routes.iter().any(|route| route["path"] == "/events"));
        assert!(routes.iter().any(|route| route["path"] == "/api/prompt"));
    }

    #[test]
    fn git_status_round_trips() {
        assert_value_round_trip::<GitStatusResponse>("git_status_response.json");
    }
}
