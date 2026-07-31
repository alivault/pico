use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::timeout;
use tracing::{debug, warn};

const MAX_RECORD_BYTES: usize = 1024 * 1024;
const MAX_PENDING_REQUESTS: usize = 64;
const MONITOR_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug)]
pub enum AuthBridgeError {
    Io(std::io::Error),
    InvalidCommand,
    InvalidRecord(String),
    ProcessExited,
    RequestFailed(String),
    RequestTimeout,
    TooManyPendingRequests,
}

impl fmt::Display for AuthBridgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::InvalidCommand => formatter.write_str("auth bridge command must be an object"),
            Self::InvalidRecord(message) => {
                write!(formatter, "invalid auth bridge record: {message}")
            }
            Self::ProcessExited => formatter.write_str("Pi auth bridge process exited"),
            Self::RequestFailed(message) => {
                write!(formatter, "Pi auth bridge request failed: {message}")
            }
            Self::RequestTimeout => formatter.write_str("Pi auth bridge request timed out"),
            Self::TooManyPendingRequests => {
                formatter.write_str("Pi auth bridge request queue is full")
            }
        }
    }
}

impl std::error::Error for AuthBridgeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AuthBridgeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

type PendingRequest = oneshot::Sender<Result<Value, String>>;

pub struct AuthBridge {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    events: broadcast::Sender<Value>,
    next_request_id: AtomicU64,
    running: AtomicBool,
}

impl AuthBridge {
    pub async fn spawn(
        binary: PathBuf,
        agent_dir: PathBuf,
        cwd: PathBuf,
    ) -> Result<Arc<Self>, AuthBridgeError> {
        let mut child = Command::new(binary)
            .current_dir(cwd)
            .env("PI_CODING_AGENT_DIR", agent_dir)
            .env("PICO_PI_BRIDGE", "true")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child.stdin.take().ok_or(AuthBridgeError::ProcessExited)?;
        let stdout = child.stdout.take().ok_or(AuthBridgeError::ProcessExited)?;
        let stderr = child.stderr.take().ok_or(AuthBridgeError::ProcessExited)?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (events, _) = broadcast::channel(256);
        let bridge = Arc::new(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: pending.clone(),
            events: events.clone(),
            next_request_id: AtomicU64::new(1),
            running: AtomicBool::new(true),
        });
        tokio::spawn(read_stdout(stdout, pending, events));
        tokio::spawn(monitor_child(Arc::downgrade(&bridge)));
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut record = Vec::new();
            loop {
                record.clear();
                match reader.read_until(b'\n', &mut record).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(trim_delimiter(&record));
                        if !text.trim().is_empty() {
                            debug!(target: "pico_server::pi_bridge", "{text}");
                        }
                    }
                    Err(error) => {
                        warn!(%error, "failed to read Pi auth bridge stderr");
                        break;
                    }
                }
            }
        });
        Ok(bridge)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    pub async fn request(
        &self,
        command: Value,
        request_timeout: Option<Duration>,
    ) -> Result<Value, AuthBridgeError> {
        if !self.is_running() {
            return Err(AuthBridgeError::ProcessExited);
        }
        let mut command = command
            .as_object()
            .cloned()
            .ok_or(AuthBridgeError::InvalidCommand)?;
        if command.get("type").and_then(Value::as_str).is_none() {
            return Err(AuthBridgeError::InvalidCommand);
        }
        let request_id = format!(
            "pico-auth:{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        command.insert("id".into(), Value::String(request_id.clone()));
        let mut encoded = serde_json::to_vec(&Value::Object(command))
            .map_err(|error| AuthBridgeError::InvalidRecord(error.to_string()))?;
        if encoded.len() > MAX_RECORD_BYTES {
            return Err(AuthBridgeError::InvalidRecord(
                "record exceeds the 1 MiB bridge limit".into(),
            ));
        }
        encoded.push(b'\n');
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.len() >= MAX_PENDING_REQUESTS {
                return Err(AuthBridgeError::TooManyPendingRequests);
            }
            pending.insert(request_id.clone(), sender);
        }
        if let Err(error) = self.write(&encoded).await {
            self.pending.lock().await.remove(&request_id);
            return Err(error);
        }
        let response = if let Some(duration) = request_timeout {
            match timeout(duration, receiver).await {
                Ok(response) => response,
                Err(_) => {
                    self.pending.lock().await.remove(&request_id);
                    return Err(AuthBridgeError::RequestTimeout);
                }
            }
        } else {
            receiver.await
        };
        match response {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(AuthBridgeError::RequestFailed(error)),
            Err(_) => Err(AuthBridgeError::ProcessExited),
        }
    }

    pub async fn send_ui_response(&self, response: Value) -> Result<(), AuthBridgeError> {
        let mut encoded = serde_json::to_vec(&response)
            .map_err(|error| AuthBridgeError::InvalidRecord(error.to_string()))?;
        if encoded.len() > MAX_RECORD_BYTES {
            return Err(AuthBridgeError::InvalidRecord(
                "record exceeds the 1 MiB bridge limit".into(),
            ));
        }
        encoded.push(b'\n');
        self.write(&encoded).await
    }

    pub async fn shutdown(&self) -> Result<(), AuthBridgeError> {
        self.running.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        if child.try_wait()?.is_none() {
            child.start_kill()?;
            child.wait().await?;
        }
        Ok(())
    }

    async fn write(&self, encoded: &[u8]) -> Result<(), AuthBridgeError> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(encoded).await?;
        stdin.flush().await?;
        Ok(())
    }
}

async fn read_stdout(
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    events: broadcast::Sender<Value>,
) {
    let mut reader = BufReader::new(stdout);
    let mut record = Vec::new();
    loop {
        record.clear();
        match reader.read_until(b'\n', &mut record).await {
            Ok(0) => break,
            Ok(_) if record.len() > MAX_RECORD_BYTES => {
                warn!(
                    bytes = record.len(),
                    "discarding oversized Pi auth bridge record"
                );
            }
            Ok(_) => match serde_json::from_slice::<Value>(trim_delimiter(&record)) {
                Ok(value) => dispatch_record(value, &pending, &events).await,
                Err(error) => warn!(%error, "discarding invalid Pi auth bridge record"),
            },
            Err(error) => {
                warn!(%error, "failed to read Pi auth bridge stdout");
                break;
            }
        }
    }
    let waiting = pending
        .lock()
        .await
        .drain()
        .map(|(_, sender)| sender)
        .collect::<Vec<_>>();
    for sender in waiting {
        let _ = sender.send(Err("Pi auth bridge process exited".into()));
    }
}

async fn dispatch_record(
    value: Value,
    pending: &Mutex<HashMap<String, PendingRequest>>,
    events: &broadcast::Sender<Value>,
) {
    if value.get("type").and_then(Value::as_str) == Some("response") {
        if let Some(request_id) = value.get("id").and_then(Value::as_str) {
            if let Some(sender) = pending.lock().await.remove(request_id) {
                let result = if value.get("success").and_then(Value::as_bool) == Some(true) {
                    Ok(value.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Pi auth bridge request failed")
                        .to_string())
                };
                let _ = sender.send(result);
                return;
            }
        }
    }
    let _ = events.send(value);
}

async fn monitor_child(bridge: std::sync::Weak<AuthBridge>) {
    loop {
        tokio::time::sleep(MONITOR_INTERVAL).await;
        let Some(bridge) = bridge.upgrade() else {
            return;
        };
        if !bridge.is_running() {
            return;
        }
        let status = {
            let mut child = bridge.child.lock().await;
            match child.try_wait() {
                Ok(status) => status,
                Err(error) => {
                    warn!(%error, "failed to inspect Pi auth bridge process");
                    None
                }
            }
        };
        let Some(status) = status else {
            continue;
        };
        if !bridge.running.swap(false, Ordering::AcqRel) {
            return;
        }
        let _ = bridge.events.send(serde_json::json!({
          "type": "pico_pi_bridge_exited",
          "exitCode": status.code(),
          "success": status.success()
        }));
        return;
    }
}

fn trim_delimiter(mut record: &[u8]) -> &[u8] {
    if record.ends_with(b"\n") {
        record = &record[..record.len() - 1];
    }
    if record.ends_with(b"\r") {
        record = &record[..record.len() - 1];
    }
    record
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn bridge_correlates_requests_and_forwards_ui_events() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("pico-auth-bridge-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("test root");
        let script = root.join("bridge.py");
        std::fs::write(
            &script,
            r#"#!/usr/bin/env python3
import json, sys
for line in sys.stdin:
    command = json.loads(line)
    if command.get("type") == "extension_ui_response":
        continue
    print(json.dumps({"type":"extension_ui_request","id":"ui-test","method":"confirm","title":"Continue?"}), flush=True)
    print(json.dumps({"id":command["id"],"type":"response","command":command["type"],"success":True,"data":{"ok":True}}), flush=True)
"#,
        )
        .expect("bridge script");
        let mut permissions = std::fs::metadata(&script).expect("metadata").permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&script, permissions).expect("permissions");
        let bridge = AuthBridge::spawn(script, root.clone(), root.clone())
            .await
            .expect("spawn bridge");
        let mut events = bridge.subscribe();
        let response = bridge
            .request(
                serde_json::json!({"type":"test"}),
                Some(Duration::from_secs(2)),
            )
            .await
            .expect("bridge response");
        assert_eq!(response["ok"], true);
        let event = timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("event timeout")
            .expect("event");
        assert_eq!(event["type"], "extension_ui_request");
        bridge
            .send_ui_response(serde_json::json!({
                "type":"extension_ui_response", "id":"ui-test", "confirmed":true
            }))
            .await
            .expect("UI response");
        let oversized = bridge
            .request(
                serde_json::json!({
                    "type": "test",
                    "value": "x".repeat(MAX_RECORD_BYTES)
                }),
                Some(Duration::from_secs(2)),
            )
            .await
            .expect_err("oversized record must fail before write");
        assert!(matches!(oversized, AuthBridgeError::InvalidRecord(_)));
        bridge.shutdown().await.expect("shutdown");
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
