use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PiCommand {
    GetState,
    GetMessages,
    GetEntries {
        #[serde(skip_serializing_if = "Option::is_none")]
        since: Option<String>,
    },
    GetTree,
    GetCommands,
    GetAvailableModels,
    GetAvailableThinkingLevels,
    GetSessionStats,
    GetLastAssistantText,
    Prompt {
        message: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        images: Vec<PiImage>,
        #[serde(rename = "streamingBehavior", skip_serializing_if = "Option::is_none")]
        streaming_behavior: Option<StreamingBehavior>,
    },
    Steer {
        message: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        images: Vec<PiImage>,
    },
    FollowUp {
        message: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        images: Vec<PiImage>,
    },
    Abort,
    NewSession {
        #[serde(rename = "parentSession", skip_serializing_if = "Option::is_none")]
        parent_session: Option<String>,
    },
    SwitchSession {
        #[serde(rename = "sessionPath")]
        session_path: String,
    },
    Fork {
        #[serde(rename = "entryId")]
        entry_id: String,
    },
    Clone,
    GetForkMessages,
    SetSessionName {
        name: String,
    },
    SetModel {
        provider: String,
        #[serde(rename = "modelId")]
        model_id: String,
    },
    SetThinkingLevel {
        level: String,
    },
    Compact {
        #[serde(rename = "customInstructions", skip_serializing_if = "Option::is_none")]
        custom_instructions: Option<String>,
    },
    ExtensionUiResponse {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        confirmed: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cancelled: Option<bool>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamingBehavior {
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiImage {
    #[serde(rename = "type")]
    pub kind: String,
    pub data: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PiResponse {
    #[serde(default)]
    pub id: Option<String>,
    pub command: String,
    pub success: bool,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PiEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: serde_json::Map<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_uses_pi_rpc_field_names() {
        let value = serde_json::to_value(PiCommand::Prompt {
            message: "hello".into(),
            images: Vec::new(),
            streaming_behavior: Some(StreamingBehavior::FollowUp),
        })
        .expect("serialize");
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["streamingBehavior"], "followUp");
        assert!(value.get("images").is_none());
    }

    #[test]
    fn session_commands_use_documented_camel_case_fields() {
        let value = serde_json::to_value(PiCommand::SwitchSession {
            session_path: "/tmp/session.jsonl".into(),
        })
        .expect("serialize");
        assert_eq!(value["type"], "switch_session");
        assert_eq!(value["sessionPath"], "/tmp/session.jsonl");
    }
}
