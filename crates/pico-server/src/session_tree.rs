use std::collections::HashMap;
use std::io;

use serde_json::{json, Map, Value};

const MAX_TREE_BYTES: usize = 32 * 1024 * 1024;
const PREVIEW_CHARS: usize = 2000;

struct Node {
    entry: Value,
    children: Vec<usize>,
}

/// Keep the wire tree nested for existing clients, but never construct a deeply
/// recursive serde_json::Value. Parsing, serialization and drop must all remain
/// safe for sessions with thousands of entries in a single branch.
pub fn serialize_tree(
    entries: impl IntoIterator<Item = io::Result<Value>>,
    leaf_id: Option<&str>,
    streaming: bool,
) -> io::Result<Vec<u8>> {
    let mut nodes = Vec::new();
    let mut by_id = HashMap::new();
    let mut labels = HashMap::new();
    let mut projected_bytes = 0;
    for entry in entries {
        let entry = entry?;
        let Some(id) = entry.get("id").and_then(Value::as_str) else {
            continue;
        };
        if entry["type"] == "label" {
            if let Some(target) = entry["targetId"].as_str() {
                labels.insert(
                    target.to_owned(),
                    (entry["label"].clone(), entry["timestamp"].clone()),
                );
            }
        }
        if by_id.insert(id.to_owned(), nodes.len()).is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Duplicate session tree entry",
            ));
        }
        let entry = project_entry(&entry);
        projected_bytes += serde_json::to_vec(&entry)?.len() + 64;
        check_size(projected_bytes)?;
        nodes.push(Node {
            entry,
            children: Vec::new(),
        });
    }

    let mut roots = Vec::new();
    for index in 0..nodes.len() {
        let parent = nodes[index].entry["parentId"]
            .as_str()
            .and_then(|id| by_id.get(id))
            .copied();
        if let Some(parent) = parent.filter(|parent| *parent != index) {
            nodes[parent].children.push(index);
        } else {
            roots.push(index);
        }
    }
    let timestamps = nodes
        .iter()
        .map(|node| node.entry["timestamp"].as_str().unwrap_or("").to_owned())
        .collect::<Vec<_>>();
    for node in &mut nodes {
        node.children
            .sort_by(|a, b| timestamps[*a].cmp(&timestamps[*b]));
    }

    let mut output = serde_json::to_vec(&json!({
        "ok": true,
        "leafId": leaf_id,
        "streamingEntryId": if streaming { leaf_id } else { None },
    }))?;
    output.pop();
    output.extend_from_slice(b",\"tree\":[");
    // None closes a node; Some opens one. This stack replaces recursive JSON
    // serialization (and avoids the decoder's 128-level RPC nesting limit).
    let mut stack = roots
        .iter()
        .enumerate()
        .rev()
        .map(|(i, index)| Some((*index, i > 0)))
        .collect::<Vec<_>>();
    let mut visited = vec![false; nodes.len()];
    while let Some(task) = stack.pop() {
        if let Some((index, comma)) = task {
            if std::mem::replace(&mut visited[index], true) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Cyclic session tree",
                ));
            }
            if comma {
                output.push(b',');
            }
            let node = &nodes[index];
            let mut fields = json!({"entry": node.entry});
            if let Some((label, timestamp)) =
                node.entry["id"].as_str().and_then(|id| labels.get(id))
            {
                if label.is_string() {
                    fields["label"] = label.clone();
                    fields["labelTimestamp"] = timestamp.clone();
                }
            }
            serde_json::to_writer(&mut output, &fields)?;
            output.pop();
            output.extend_from_slice(b",\"children\":[");
            stack.push(None);
            stack.extend(
                node.children
                    .iter()
                    .enumerate()
                    .rev()
                    .map(|(i, child)| Some((*child, i > 0))),
            );
        } else {
            output.extend_from_slice(b"]}");
        }
        check_size(output.len())?;
    }
    if visited.iter().any(|visited| !visited) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Cyclic session tree",
        ));
    }
    output.extend_from_slice(b"]}");
    check_size(output.len())?;
    Ok(output)
}

fn check_size(bytes: usize) -> io::Result<()> {
    if bytes > MAX_TREE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Session tree is too large",
        ));
    }
    Ok(())
}

fn preview(text: &str) -> String {
    text.chars().take(PREVIEW_CHARS).collect()
}

fn project_entry(entry: &Value) -> Value {
    let mut result = Map::new();
    for key in [
        "id",
        "parentId",
        "timestamp",
        "type",
        "customType",
        "text",
        "tokensBefore",
        "summary",
        "modelId",
        "thinkingLevel",
        "name",
        "label",
    ] {
        if let Some(value) = entry.get(key) {
            if value.is_null() || value.is_number() || value.is_string() {
                result.insert(
                    key.into(),
                    match value.as_str() {
                        Some(text) if matches!(key, "text" | "summary") => {
                            Value::String(preview(text))
                        }
                        _ => value.clone(),
                    },
                );
            }
        }
    }
    if let Some(message) = entry.get("message") {
        let mut projected = Map::new();
        for key in [
            "role",
            "stopReason",
            "errorMessage",
            "toolCallId",
            "toolName",
            "command",
        ] {
            if let Some(text) = message[key].as_str() {
                projected.insert(key.into(), Value::String(preview(text)));
            }
        }
        let text = match &message["content"] {
            Value::String(text) => preview(text),
            Value::Array(parts) => parts
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .flat_map(|text| text.chars().chain(std::iter::once('\n')))
                .take(PREVIEW_CHARS)
                .collect::<String>()
                .trim_end()
                .to_owned(),
            _ => String::new(),
        };
        projected.insert("text".into(), Value::String(text));
        if let Some(parts) = message["content"].as_array() {
            let tools = parts
                .iter()
                .filter(|part| part["type"] == "toolCall")
                .map(|part| {
                    json!({
                        "id": part["id"].as_str(),
                        "name": part["name"].as_str(),
                        "preview": preview(&part["arguments"].to_string()),
                    })
                })
                .collect::<Vec<_>>();
            if !tools.is_empty() {
                projected.insert("toolCalls".into(), Value::Array(tools));
            }
        }
        result.insert("message".into(), Value::Object(projected));
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(entries: Vec<Value>, leaf: Option<&str>, streaming: bool) -> Value {
        serde_json::from_slice(
            &serialize_tree(entries.into_iter().map(Ok), leaf, streaming).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn preserves_branches_labels_order_and_message_previews() {
        let result = tree(
            vec![
                json!({"id":"root", "type":"message", "parentId":null,
                "message":{"role":"user", "content":[{"type":"text","text":"hello"}, {"type":"image","data":"secret-image"}]}}),
                json!({"id":"later", "type":"message", "parentId":"root", "timestamp":"2026-01-02T00:00:00Z",
                "message":{"role":"assistant", "content":[{"type":"toolCall", "id":"call", "name":"read", "arguments":{"path":"file.rs"}}]}}),
                json!({"id":"earlier", "type":"message", "parentId":"root", "timestamp":"2026-01-01T00:00:00Z"}),
                json!({"id":"label", "type":"label", "parentId":"earlier", "targetId":"root", "label":"Start", "timestamp":"2026-01-03T00:00:00Z"}),
                json!({"id":"orphan", "type":"custom", "parentId":"missing"}),
            ],
            Some("orphan"),
            true,
        );
        assert_eq!(result["leafId"], "orphan");
        assert_eq!(result["streamingEntryId"], "orphan");
        assert_eq!(result["tree"][0]["label"], "Start");
        assert_eq!(result["tree"][0]["labelTimestamp"], "2026-01-03T00:00:00Z");
        assert_eq!(result["tree"][0]["entry"]["message"]["text"], "hello");
        assert_eq!(result["tree"][0]["children"][0]["entry"]["id"], "earlier");
        assert_eq!(
            result["tree"][0]["children"][1]["entry"]["message"]["toolCalls"][0]["name"],
            "read"
        );
        assert_eq!(result["tree"][1]["entry"]["id"], "orphan");
        assert!(!result.to_string().contains("secret-image"));
    }

    #[test]
    fn latest_label_can_clear_a_previous_label() {
        let result = tree(
            vec![
                json!({"id":"root", "type":"custom", "parentId":"root"}),
                json!({"id":"l1", "type":"label", "parentId":"root", "targetId":"root", "label":"Old"}),
                json!({"id":"l2", "type":"label", "parentId":"l1", "targetId":"root"}),
            ],
            Some("l2"),
            false,
        );
        assert!(result["tree"][0].get("label").is_none());
        assert!(result["streamingEntryId"].is_null());
        assert_eq!(tree(vec![], None, false)["tree"], json!([]));
    }

    #[test]
    fn deep_trees_serialize_without_recursive_values_or_stack_overflow() {
        let count = 10_000;
        let entries = (0..count).map(|i| Ok(json!({
            "id": i.to_string(), "parentId": if i == 0 { None } else { Some((i - 1).to_string()) }, "type":"custom"
        })));
        let output =
            String::from_utf8(serialize_tree(entries, Some("9999"), false).unwrap()).unwrap();
        assert_eq!(output.matches("\"children\":[").count(), count);
        assert!(output.contains("\"id\":\"9999\""));
        assert!(output.ends_with(&"]}".repeat(count + 1)));
    }

    #[test]
    fn malformed_or_oversized_trees_fail_instead_of_hanging() {
        assert!(serialize_tree(
            [
                Ok(json!({"id":"a", "parentId":"b"})),
                Ok(json!({"id":"b", "parentId":"a"})),
            ],
            None,
            false
        )
        .is_err());
        assert!(
            serialize_tree([Ok(json!({"id":"a"})), Ok(json!({"id":"a"})),], None, false).is_err()
        );
        assert!(serialize_tree([Err(io::Error::other("read failed"))], None, false).is_err());
        assert!(check_size(MAX_TREE_BYTES + 1).is_err());
    }
}
