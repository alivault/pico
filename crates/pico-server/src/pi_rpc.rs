use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::timeout;
use tracing::{debug, warn};

const MAX_RPC_RECORD_BYTES: usize = 32 * 1024 * 1024;
const MAX_PENDING_REQUESTS: usize = 256;
const CHILD_MONITOR_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone)]
pub struct PiSpawnOptions {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub session: Option<PathBuf>,
    pub session_dir: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
}

impl PiSpawnOptions {
    pub fn new(binary: PathBuf, cwd: PathBuf) -> Self {
        Self {
            binary,
            cwd,
            session: None,
            session_dir: None,
            environment: BTreeMap::new(),
        }
    }

    pub fn with_session(mut self, session: Option<PathBuf>) -> Self {
        self.session = session;
        self
    }

    pub fn with_session_dir(mut self, session_dir: Option<PathBuf>) -> Self {
        self.session_dir = session_dir;
        self
    }
}

#[derive(Debug)]
pub enum PiRpcError {
    Io(std::io::Error),
    InvalidCommand(&'static str),
    InvalidRecord(String),
    ProcessExited,
    RequestFailed(String),
    RequestTimeout,
    TooManyPendingRequests,
}

impl fmt::Display for PiRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::InvalidCommand(message) => formatter.write_str(message),
            Self::InvalidRecord(message) => write!(formatter, "invalid Pi RPC record: {message}"),
            Self::ProcessExited => formatter.write_str("Pi RPC process exited"),
            Self::RequestFailed(message) => write!(formatter, "Pi RPC request failed: {message}"),
            Self::RequestTimeout => formatter.write_str("Pi RPC request timed out"),
            Self::TooManyPendingRequests => formatter.write_str("Pi RPC request queue is full"),
        }
    }
}

impl std::error::Error for PiRpcError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for PiRpcError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

type PendingRequest = oneshot::Sender<Result<Value, String>>;

/// A language-neutral Pi integration. The native Pico server owns the process,
/// while Pi continues to own provider behavior, tools, extensions, and session
/// files through its documented strict-JSONL RPC mode.
pub struct PiRpcClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    events: broadcast::Sender<Value>,
    next_request_id: AtomicU64,
    running: AtomicBool,
}

impl PiRpcClient {
    pub async fn spawn(options: PiSpawnOptions) -> Result<Arc<Self>, PiRpcError> {
        let mut command = Command::new(&options.binary);
        command
            .arg("--mode")
            .arg("rpc")
            .current_dir(&options.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PI_CODING_AGENT", "true")
            .envs(&options.environment)
            .kill_on_drop(true);
        if let Some(session_dir) = &options.session_dir {
            command.arg("--session-dir").arg(session_dir);
        }
        if let Some(session) = &options.session {
            command.arg("--session").arg(session);
        }

        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or(PiRpcError::ProcessExited)?;
        let stdout = child.stdout.take().ok_or(PiRpcError::ProcessExited)?;
        let stderr = child.stderr.take().ok_or(PiRpcError::ProcessExited)?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (events, _) = broadcast::channel(512);

        let client = Arc::new(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: pending.clone(),
            events: events.clone(),
            next_request_id: AtomicU64::new(1),
            running: AtomicBool::new(true),
        });

        tokio::spawn(read_stdout(stdout, pending, events));
        tokio::spawn(monitor_child(Arc::downgrade(&client)));
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut record = Vec::new();
            loop {
                record.clear();
                match reader.read_until(b'\n', &mut record).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(trim_record_delimiter(&record));
                        if !text.trim().is_empty() {
                            debug!(target: "pico_server::pi", "{text}");
                        }
                    }
                    Err(error) => {
                        warn!(%error, "failed to read Pi RPC stderr");
                        break;
                    }
                }
            }
        });

        Ok(client)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    pub async fn request_typed(
        &self,
        command: &crate::pi_protocol::PiCommand,
    ) -> Result<Value, PiRpcError> {
        let command = serde_json::to_value(command)
            .map_err(|error| PiRpcError::InvalidRecord(error.to_string()))?;
        self.request(command).await
    }

    pub async fn request(&self, command: Value) -> Result<Value, PiRpcError> {
        self.request_with_timeout(command, None).await
    }

    pub async fn notify(&self, command: Value) -> Result<(), PiRpcError> {
        if !self.is_running() {
            return Err(PiRpcError::ProcessExited);
        }
        let command = match command {
            Value::Object(command) if command.contains_key("type") => command,
            Value::Object(_) => {
                return Err(PiRpcError::InvalidCommand(
                    "Pi RPC command must contain a type",
                ))
            }
            _ => {
                return Err(PiRpcError::InvalidCommand(
                    "Pi RPC command must be an object",
                ))
            }
        };
        let encoded = encode_command(command)?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&encoded).await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn request_with_timeout(
        &self,
        command: Value,
        request_timeout: Option<Duration>,
    ) -> Result<Value, PiRpcError> {
        if !self.is_running() {
            return Err(PiRpcError::ProcessExited);
        }
        let mut command = match command {
            Value::Object(command) => command,
            _ => {
                return Err(PiRpcError::InvalidCommand(
                    "Pi RPC command must be an object",
                ))
            }
        };
        if !command.contains_key("type") {
            return Err(PiRpcError::InvalidCommand(
                "Pi RPC command must contain a type",
            ));
        }

        let request_number = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request_id = format!("pico:{request_number}");
        command.insert("id".into(), Value::String(request_id.clone()));
        let encoded = encode_command(command)?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.len() >= MAX_PENDING_REQUESTS {
                return Err(PiRpcError::TooManyPendingRequests);
            }
            pending.insert(request_id.clone(), sender);
        }

        let write_result = async {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(&encoded).await?;
            stdin.flush().await
        }
        .await;
        if let Err(error) = write_result {
            self.pending.lock().await.remove(&request_id);
            return Err(PiRpcError::Io(error));
        }

        let response = if let Some(request_timeout) = request_timeout {
            match timeout(request_timeout, receiver).await {
                Ok(response) => response,
                Err(_) => {
                    self.pending.lock().await.remove(&request_id);
                    return Err(PiRpcError::RequestTimeout);
                }
            }
        } else {
            receiver.await
        };
        match response {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(message)) => Err(PiRpcError::RequestFailed(message)),
            Err(_) => Err(PiRpcError::ProcessExited),
        }
    }

    pub async fn shutdown(&self) -> Result<(), PiRpcError> {
        self.running.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let result = match child.try_wait()? {
            Some(status) => status,
            None => {
                child.start_kill()?;
                child.wait().await?
            }
        };
        debug!(status = %result, "Pi RPC process stopped");
        Ok(())
    }
}

async fn monitor_child(client: std::sync::Weak<PiRpcClient>) {
    loop {
        tokio::time::sleep(CHILD_MONITOR_INTERVAL).await;
        let Some(client) = client.upgrade() else {
            return;
        };
        if !client.is_running() {
            return;
        }
        let status = {
            let mut child = client.child.lock().await;
            match child.try_wait() {
                Ok(status) => status,
                Err(error) => {
                    warn!(%error, "failed to inspect Pi RPC process");
                    None
                }
            }
        };
        let Some(status) = status else {
            continue;
        };
        if !client.running.swap(false, Ordering::AcqRel) {
            return;
        }
        let _ = client.events.send(serde_json::json!({
          "type": "pico_pi_process_exited",
          "exitCode": status.code(),
          "success": status.success()
        }));
        return;
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
            Ok(_) if record.len() > MAX_RPC_RECORD_BYTES => {
                warn!(bytes = record.len(), "discarding oversized Pi RPC record");
            }
            Ok(_) => match decode_record(&record) {
                Ok(value) => dispatch_record(value, &pending, &events).await,
                Err(error) => warn!(%error, "discarding invalid Pi RPC record"),
            },
            Err(error) => {
                warn!(%error, "failed to read Pi RPC stdout");
                break;
            }
        }
    }

    let waiting = {
        let mut pending = pending.lock().await;
        pending
            .drain()
            .map(|(_, sender)| sender)
            .collect::<Vec<_>>()
    };
    for sender in waiting {
        let _ = sender.send(Err("Pi RPC process exited".into()));
    }
}

async fn dispatch_record(
    value: Value,
    pending: &Mutex<HashMap<String, PendingRequest>>,
    events: &broadcast::Sender<Value>,
) {
    let request_id = value.get("id").and_then(Value::as_str);
    if value.get("type").and_then(Value::as_str) == Some("response") {
        if let Some(request_id) = request_id {
            if let Some(sender) = pending.lock().await.remove(request_id) {
                let _ = sender.send(Ok(value));
                return;
            }
        }
    }

    let _ = events.send(value);
}

fn encode_command(mut command: Map<String, Value>) -> Result<Vec<u8>, PiRpcError> {
    let mut encoded = serde_json::to_vec(&Value::Object(std::mem::take(&mut command)))
        .map_err(|error| PiRpcError::InvalidRecord(error.to_string()))?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn decode_record(record: &[u8]) -> Result<Value, PiRpcError> {
    let record = trim_record_delimiter(record);
    if record.is_empty() {
        return Err(PiRpcError::InvalidRecord("empty record".into()));
    }
    serde_json::from_slice(record).map_err(|error| PiRpcError::InvalidRecord(error.to_string()))
}

fn trim_record_delimiter(mut record: &[u8]) -> &[u8] {
    if record.ends_with(b"\n") {
        record = &record[..record.len() - 1];
    }
    if record.ends_with(b"\r") {
        record = &record[..record.len() - 1];
    }
    record
}

pub async fn detect_pi_version(binary: &PathBuf) -> Result<String, PiRpcError> {
    let output = Command::new(binary).arg("--version").output().await?;
    if !output.status.success() {
        return Err(PiRpcError::RequestFailed(format!(
            "{} --version exited with {}",
            binary.display(),
            output.status
        )));
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(PiRpcError::InvalidRecord(
            "Pi returned an empty version".into(),
        ));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn fake_pi(exit_on_command: bool) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!(
            "pico-fake-pi-{}-{}",
            std::process::id(),
            NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).expect("create fake Pi directory");
        let path = directory.join("pi");
        let exit = if exit_on_command { "exit 7" } else { "" };
        std::fs::write(
            &path,
            format!(
                r#"#!/bin/sh
while IFS= read -r line; do
  {exit}
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  kind=$(printf '%s' "$line" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
  printf '{{"id":"%s","type":"response","command":"%s","success":true,"data":{{"ok":true}}}}\n' "$id" "$kind"
  printf '{{"type":"agent_settled"}}\n'
done
"#
            ),
        )
        .expect("write fake Pi");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("make fake Pi executable");
        (directory, path)
    }

    #[cfg(unix)]
    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn strict_jsonl_keeps_unicode_line_separators_inside_json() {
        let record = b"{\"type\":\"message\",\"text\":\"before\\u2028after\\u2029done\"}\n";
        let decoded = decode_record(record).expect("decode record");
        assert_eq!(decoded["text"], "before\u{2028}after\u{2029}done");
    }

    #[test]
    fn strict_jsonl_accepts_crlf_but_not_multiple_records() {
        let decoded = decode_record(b"{\"type\":\"get_state\"}\r\n").expect("decode CRLF");
        assert_eq!(decoded["type"], "get_state");
        assert!(decode_record(b"{\"type\":\"one\"}\n{\"type\":\"two\"}\n").is_err());
    }

    #[test]
    fn command_encoding_replaces_external_id_and_appends_lf() {
        let mut command = Map::new();
        command.insert("type".into(), Value::String("get_state".into()));
        command.insert("id".into(), Value::String("pico:1".into()));
        let encoded = encode_command(command).expect("encode command");
        assert!(encoded.ends_with(b"\n"));
        assert_eq!(encoded.iter().filter(|byte| **byte == b'\n').count(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn typed_commands_and_events_work_with_a_child_process() {
        let (directory, binary) = fake_pi(false);
        let client = PiRpcClient::spawn(PiSpawnOptions::new(binary, directory.clone()))
            .await
            .expect("spawn fake Pi");
        let mut events = client.subscribe();
        let response = client
            .request_typed(&crate::pi_protocol::PiCommand::GetState)
            .await
            .expect("get state");
        assert_eq!(response["success"], true);
        assert_eq!(response["command"], "get_state");
        let event = timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("event timeout")
            .expect("event");
        assert_eq!(event["type"], "agent_settled");
        client
            .notify(serde_json::json!({
                "type": "extension_ui_response",
                "id": "ui-request",
                "confirmed": true
            }))
            .await
            .expect("send notification");
        let notification_response = timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("notification timeout")
            .expect("notification response");
        assert_eq!(notification_response["id"], "ui-request");
        assert_eq!(notification_response["command"], "extension_ui_response");
        client.shutdown().await.expect("shutdown");
        assert!(!client.is_running());
        std::fs::remove_dir_all(directory).expect("remove fake Pi directory");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unexpected_child_exit_fails_requests_and_emits_status() {
        let (directory, binary) = fake_pi(true);
        let client = PiRpcClient::spawn(PiSpawnOptions::new(binary, directory.clone()))
            .await
            .expect("spawn fake Pi");
        let mut events = client.subscribe();
        let error = client
            .request_typed(&crate::pi_protocol::PiCommand::GetState)
            .await
            .expect_err("request should fail");
        assert!(matches!(
            error,
            PiRpcError::ProcessExited | PiRpcError::RequestFailed(_)
        ));
        let event = timeout(Duration::from_secs(2), async {
            loop {
                let event = events.recv().await.expect("event");
                if event["type"] == "pico_pi_process_exited" {
                    return event;
                }
            }
        })
        .await
        .expect("exit event timeout");
        assert_eq!(event["exitCode"], 7);
        assert_eq!(event["success"], false);
        std::fs::remove_dir_all(directory).expect("remove fake Pi directory");
    }
}
