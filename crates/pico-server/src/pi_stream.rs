use std::collections::HashMap;

use serde_json::{json, Map, Value};

/// Reconstructs Pi's live assistant message from delta-only RPC events.
///
/// Pi 0.84 removed the cumulative `message` field from `message_update` to
/// avoid quadratic JSONL output. `message_end.message` remains authoritative.
#[derive(Default)]
pub struct PiStreamingMessage {
    message: Option<Value>,
    tool_call_buffers: HashMap<usize, String>,
}

impl PiStreamingMessage {
    pub fn message(&self) -> Option<&Value> {
        self.message.as_ref()
    }

    pub fn start(&mut self, event: &Value) {
        self.tool_call_buffers.clear();
        self.message = event.get("message").cloned();
    }

    pub fn update(&mut self, event: &Value) -> bool {
        // Compatibility with Pi releases before 0.84.
        if let Some(message) = event.get("message") {
            self.message = Some(message.clone());
            return true;
        }

        let Some(delta) = event.get("assistantMessageEvent") else {
            return false;
        };
        let Some(kind) = delta.get("type").and_then(Value::as_str) else {
            return false;
        };
        let Some(index) = delta
            .get("contentIndex")
            .and_then(Value::as_u64)
            .and_then(|index| usize::try_from(index).ok())
        else {
            return false;
        };

        match kind {
            "text_start" => self.set_content(index, json!({ "type": "text", "text": "" })),
            "text_delta" => self.append_string(index, "text", "text", delta),
            "text_end" => self.finish_string(index, "text", "text", delta),
            "thinking_start" => {
                self.set_content(index, json!({ "type": "thinking", "thinking": "" }))
            }
            "thinking_delta" => self.append_string(index, "thinking", "thinking", delta),
            "thinking_end" => self.finish_string(index, "thinking", "thinking", delta),
            "toolcall_start" => {
                self.tool_call_buffers.insert(index, String::new());
            }
            "toolcall_delta" => {
                if let Some(chunk) = delta.get("delta").and_then(Value::as_str) {
                    self.tool_call_buffers
                        .entry(index)
                        .or_default()
                        .push_str(chunk);
                }
            }
            "toolcall_end" => {
                self.tool_call_buffers.remove(&index);
                if let Some(tool_call) = delta.get("toolCall") {
                    self.set_content(index, tool_call.clone());
                }
            }
            _ => return false,
        }
        true
    }

    pub fn finish(&mut self, event: &Value) -> bool {
        let Some(message) = event.get("message") else {
            return false;
        };
        self.message = Some(message.clone());
        self.tool_call_buffers.clear();
        true
    }

    pub fn clear(&mut self) {
        self.message = None;
        self.tool_call_buffers.clear();
    }

    fn message_object(&mut self) -> &mut Map<String, Value> {
        if !self.message.as_ref().is_some_and(Value::is_object) {
            self.message = Some(json!({
              "role": "assistant",
              "content": [],
              "stopReason": "pending"
            }));
        }
        self.message
            .as_mut()
            .and_then(Value::as_object_mut)
            .expect("streaming message was initialized as an object")
    }

    fn content(&mut self) -> &mut Vec<Value> {
        let message = self.message_object();
        if !message.get("content").is_some_and(Value::is_array) {
            message.insert("content".into(), Value::Array(Vec::new()));
        }
        message
            .get_mut("content")
            .and_then(Value::as_array_mut)
            .expect("streaming content was initialized as an array")
    }

    fn set_content(&mut self, index: usize, value: Value) {
        let content = self.content();
        if content.len() <= index {
            content.resize(index + 1, Value::Null);
        }
        content[index] = value;
    }

    fn append_string(&mut self, index: usize, part_type: &str, field: &str, delta: &Value) {
        let Some(chunk) = delta.get("delta").and_then(Value::as_str) else {
            return;
        };
        let content = self.content();
        if content.len() <= index {
            content.resize(index + 1, Value::Null);
        }
        if content[index].get("type").and_then(Value::as_str) != Some(part_type) {
            content[index] = string_part(part_type, field, "");
        }
        if let Some(Value::String(text)) = content[index].get_mut(field) {
            text.push_str(chunk);
        }
    }

    fn finish_string(&mut self, index: usize, part_type: &str, field: &str, delta: &Value) {
        if let Some(value) = delta.get("content").and_then(Value::as_str) {
            self.set_content(index, string_part(part_type, field, value));
        }
    }
}

fn string_part(part_type: &str, field: &str, value: &str) -> Value {
    let mut part = Map::new();
    part.insert("type".into(), Value::String(part_type.into()));
    part.insert(field.into(), Value::String(value.into()));
    Value::Object(part)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconstructs_delta_only_assistant_messages() {
        let mut message = PiStreamingMessage::default();
        message.start(&json!({
          "type": "message_start",
          "message": {
            "role": "assistant",
            "content": [],
            "provider": "test",
            "model": "test-model",
            "stopReason": "pending",
            "timestamp": 1
          }
        }));
        assert!(message.update(&json!({
          "type": "message_update",
          "assistantMessageEvent": { "type": "text_start", "contentIndex": 0 }
        })));
        assert!(message.update(&json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "text_delta",
            "contentIndex": 0,
            "delta": "hello"
          }
        })));
        assert!(message.update(&json!({
          "type": "message_update",
          "assistantMessageEvent": { "type": "thinking_start", "contentIndex": 1 }
        })));
        assert!(message.update(&json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "thinking_delta",
            "contentIndex": 1,
            "delta": "considering"
          }
        })));
        assert_eq!(message.message().unwrap()["content"][0]["text"], "hello");
        assert_eq!(
            message.message().unwrap()["content"][1]["thinking"],
            "considering"
        );
    }

    #[test]
    fn accepts_pre_084_cumulative_updates() {
        let mut message = PiStreamingMessage::default();
        let cumulative = json!({
          "role": "assistant",
          "content": [{ "type": "text", "text": "legacy" }]
        });
        assert!(message.update(&json!({
          "type": "message_update",
          "message": cumulative
        })));
        assert_eq!(message.message().unwrap()["content"][0]["text"], "legacy");
    }

    #[test]
    fn authoritative_message_end_replaces_progress() {
        let mut message = PiStreamingMessage::default();
        message.update(&json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "text_delta",
            "contentIndex": 0,
            "delta": "partial"
          }
        }));
        assert!(message.finish(&json!({
          "type": "message_end",
          "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": "complete" }]
          }
        })));
        assert_eq!(message.message().unwrap()["content"][0]["text"], "complete");
    }
}
