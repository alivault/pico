use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::protocol::{
    AssistantBlock, AssistantConversationItem, ConversationDeltaOperation, ConversationItem,
};

#[derive(Default)]
pub struct ConversationDeltaBatch {
    operations: Vec<ConversationDeltaOperation>,
}

impl ConversationDeltaBatch {
    pub fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }

    pub fn replace_item(&mut self, item: &ConversationItem) {
        if !matches!(item, ConversationItem::Assistant(_)) {
            return;
        }
        self.operations.clear();
        self.operations
            .push(ConversationDeltaOperation::ReplaceItem { item: item.clone() });
    }

    pub fn message_update_needs_item(event: &Value) -> bool {
        if event.get("message").is_some() {
            return true;
        }
        matches!(
            event
                .get("assistantMessageEvent")
                .and_then(|delta| delta.get("type"))
                .and_then(Value::as_str),
            Some(
                "text_start"
                    | "text_end"
                    | "thinking_start"
                    | "thinking_end"
                    | "toolcall_start"
                    | "toolcall_end"
            )
        )
    }

    pub fn push_message_update(&mut self, event: &Value, item: Option<&ConversationItem>) {
        if event.get("message").is_some() {
            if let Some(item) = item {
                self.replace_item(item);
            }
            return;
        }
        let Some(delta) = event.get("assistantMessageEvent") else {
            return;
        };
        let Some(kind) = delta.get("type").and_then(Value::as_str) else {
            return;
        };
        let Some(index) = delta.get("contentIndex").and_then(Value::as_u64) else {
            return;
        };
        match kind {
            "text_delta" | "thinking_delta" => {
                let Some(chunk) = delta.get("delta").and_then(Value::as_str) else {
                    return;
                };
                let block_type = if kind == "text_delta" {
                    "text"
                } else {
                    "thinking"
                };
                self.append_block(
                    index as usize,
                    format!("entry:streaming:part:{index}:{block_type}"),
                    block_type,
                    chunk,
                );
            }
            "text_start" | "text_end" | "thinking_start" | "thinking_end" | "toolcall_start"
            | "toolcall_end" => {
                if let Some(block) = item.and_then(|item| assistant_block_at(item, index as usize))
                {
                    self.operations
                        .push(ConversationDeltaOperation::ReplaceBlock {
                            content_index: index as usize,
                            block,
                        });
                }
            }
            _ => {}
        }
    }

    pub fn push_tool_update(&mut self, event: &Value) {
        let Some(call_id) = event.get("toolCallId").and_then(Value::as_str) else {
            return;
        };
        let event_type = event.get("type").and_then(Value::as_str);
        let result = event.get("result").or_else(|| event.get("partialResult"));
        let operation = ConversationDeltaOperation::UpdateTool {
            call_id: call_id.to_string(),
            output: result.map(content_text),
            details: result.and_then(|result| result.get("details")).cloned(),
            is_error: event.get("isError").and_then(Value::as_bool),
            running: event_type != Some("tool_execution_end"),
        };
        if let Some(existing) = self.operations.iter_mut().rev().find(|existing| {
            matches!(
                existing,
                ConversationDeltaOperation::UpdateTool {
                    call_id: existing_call_id,
                    ..
                } if existing_call_id == call_id
            )
        }) {
            *existing = operation;
        } else {
            self.operations.push(operation);
        }
    }

    pub fn take(&mut self) -> Vec<ConversationDeltaOperation> {
        std::mem::take(&mut self.operations)
    }

    pub fn clear(&mut self) {
        self.operations.clear();
    }

    fn append_block(
        &mut self,
        content_index: usize,
        block_key: String,
        block_type: &str,
        chunk: &str,
    ) {
        if let Some(ConversationDeltaOperation::AppendBlock {
            content_index: previous_index,
            block_key: previous_key,
            block_type: previous_type,
            delta,
        }) = self.operations.last_mut()
        {
            if *previous_index == content_index
                && previous_key == &block_key
                && previous_type == block_type
            {
                delta.push_str(chunk);
                return;
            }
        }
        self.operations
            .push(ConversationDeltaOperation::AppendBlock {
                content_index,
                block_key,
                block_type: block_type.to_string(),
                delta: chunk.to_string(),
            });
    }
}

fn assistant_block_at(item: &ConversationItem, index: usize) -> Option<AssistantBlock> {
    let ConversationItem::Assistant(AssistantConversationItem { blocks, .. }) = item else {
        return None;
    };
    blocks.get(index).cloned()
}

fn content_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    let content = value.get("content").unwrap_or(value);
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.as_str() {
                    Some(text)
                } else if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

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
                if let (Some(id), Some(name)) = (
                    delta.get("id").and_then(Value::as_str),
                    delta.get("toolName").and_then(Value::as_str),
                ) {
                    self.set_content(
                        index,
                        json!({
                          "type": "toolCall",
                          "id": id,
                          "name": name
                        }),
                    );
                }
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
    use crate::session_store::streaming_assistant_item;

    #[test]
    fn batches_compact_deltas_and_keeps_item_discriminator() {
        let mut batch = ConversationDeltaBatch::default();
        let first = json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "text_delta",
            "contentIndex": 0,
            "delta": "hello"
          }
        });
        let second = json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "text_delta",
            "contentIndex": 0,
            "delta": " world"
          }
        });
        batch.push_message_update(&first, None);
        batch.push_message_update(&second, None);
        let operations = serde_json::to_value(batch.take()).expect("serialize operations");
        assert_eq!(operations[0]["op"], "appendBlock");
        assert_eq!(operations[0]["delta"], "hello world");

        let item = streaming_assistant_item(&json!({
          "role": "assistant",
          "content": [{ "type": "text", "text": "complete" }]
        }));
        batch.replace_item(&item);
        let operations = serde_json::to_value(batch.take()).expect("serialize replacement");
        assert_eq!(operations[0]["item"]["kind"], "assistant");
    }

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
    fn exposes_tool_metadata_at_toolcall_start() {
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
        let event = json!({
          "type": "message_update",
          "assistantMessageEvent": {
            "type": "toolcall_start",
            "contentIndex": 0,
            "id": "call-1",
            "toolName": "read"
          }
        });

        assert!(message.update(&event));
        let item = streaming_assistant_item(message.message().unwrap());
        let mut batch = ConversationDeltaBatch::default();
        assert!(ConversationDeltaBatch::message_update_needs_item(&event));
        batch.push_message_update(&event, Some(&item));

        assert_eq!(message.message().unwrap()["content"][0]["id"], "call-1");
        assert_eq!(message.message().unwrap()["content"][0]["name"], "read");
        let operations = serde_json::to_value(batch.take()).expect("serialize operations");
        assert_eq!(operations[0]["op"], "replaceBlock");
        assert_eq!(operations[0]["block"]["type"], "tool");
        assert_eq!(operations[0]["block"]["callId"], "call-1");
        assert_eq!(operations[0]["block"]["name"], "read");
        assert_eq!(operations[0]["block"]["running"], true);
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
