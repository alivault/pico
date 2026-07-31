use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tokio::sync::broadcast;

const BACKLOG_MAX_CHUNKS: usize = 500;
const BACKLOG_MAX_BYTES: usize = 512 * 1024;
const EXITED_TTL: Duration = Duration::from_secs(30 * 60);
#[cfg(not(test))]
const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const MIN_COLS: u16 = 20;
const MAX_COLS: u16 = 500;
const MIN_ROWS: u16 = 5;
const MAX_ROWS: u16 = 200;
const DEFAULT_COLS: u16 = 100;
const DEFAULT_ROWS: u16 = 30;
const KEY_MAX_LENGTH: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
    Ready {
        backend: &'static str,
        id: String,
        cwd: PathBuf,
        shell: String,
        #[serde(rename = "nextInputSeq")]
        next_input_seq: u64,
    },
    Output {
        data: String,
        seq: u64,
    },
    InputAck {
        #[serde(rename = "inputSeq")]
        input_seq: u64,
    },
    Pong,
    Reset {
        reason: &'static str,
        #[serde(rename = "firstSeq")]
        first_seq: u64,
        #[serde(rename = "nextSeq")]
        next_seq: u64,
    },
    Exit {
        #[serde(rename = "exitCode")]
        exit_code: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        signal: Option<u32>,
    },
    Error {
        error: String,
    },
}

impl TerminalEvent {
    pub fn output_sequence(&self) -> Option<u64> {
        match self {
            Self::Output { seq, .. } => Some(*seq),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTerminal {
    pub id: String,
    pub backend: &'static str,
    pub cwd: PathBuf,
    pub shell: String,
    pub reused: bool,
}

#[derive(Clone)]
pub struct TerminalManager {
    inner: Arc<ManagerInner>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        let inner = Arc::new(ManagerInner::default());
        #[cfg(not(test))]
        {
            let weak_inner = Arc::downgrade(&inner);
            let _ = std::thread::Builder::new()
                .name("pico-terminal-cleanup".into())
                .spawn(move || loop {
                    std::thread::sleep(CLEANUP_INTERVAL);
                    let Some(inner) = weak_inner.upgrade() else {
                        break;
                    };
                    cleanup_exited_records(&inner);
                });
        }
        Self { inner }
    }
}

#[derive(Default)]
struct ManagerInner {
    terminals: Mutex<HashMap<String, Arc<TerminalRecord>>>,
    lookup: Mutex<HashMap<String, String>>,
}

struct TerminalRecord {
    id: String,
    scope_key: String,
    lookup_key: Option<String>,
    cwd: PathBuf,
    shell: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    events: broadcast::Sender<TerminalEvent>,
    state: Mutex<TerminalState>,
}

struct TerminalState {
    backlog: VecDeque<TerminalEvent>,
    backlog_bytes: usize,
    next_output_seq: u64,
    last_input_seq: u64,
    cols: u16,
    rows: u16,
    exited: Option<(u32, Option<u32>)>,
    last_used: Instant,
}

pub struct TerminalSubscription {
    pub ready: TerminalEvent,
    pub initial: Vec<TerminalEvent>,
    pub receiver: broadcast::Receiver<TerminalEvent>,
    pub last_initial_sequence: u64,
}

impl TerminalManager {
    pub fn create(
        &self,
        scope_key: String,
        cwd: PathBuf,
        client_key: Option<&str>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> io::Result<CreatedTerminal> {
        self.cleanup_exited();
        let terminal_key = normalize_key(client_key);
        let lookup_key = terminal_key
            .as_ref()
            .map(|key| format!("{scope_key}\0{key}"));
        if let Some(existing) = lookup_key
            .as_ref()
            .and_then(|key| self.inner.lookup.lock().ok()?.get(key).cloned())
            .and_then(|id| self.inner.terminals.lock().ok()?.get(&id).cloned())
        {
            let mut state = existing
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.exited.is_none() {
                state.last_used = Instant::now();
                return Ok(CreatedTerminal {
                    id: existing.id.clone(),
                    backend: "shell",
                    cwd: existing.cwd.clone(),
                    shell: shell_label(&existing.shell),
                    reused: true,
                });
            }
            drop(state);
            self.close(&scope_key, &existing.id)?;
        }

        let cols = cols.unwrap_or(DEFAULT_COLS).clamp(MIN_COLS, MAX_COLS);
        let rows = rows.unwrap_or(DEFAULT_ROWS).clamp(MIN_ROWS, MAX_ROWS);
        let shell = default_shell();
        let pty = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)?;
        let mut command = CommandBuilder::new(&shell);
        command.cwd(&cwd);
        configure_environment(&mut command);
        let child = pty.slave.spawn_command(command).map_err(pty_error)?;
        drop(pty.slave);
        let reader = pty.master.try_clone_reader().map_err(pty_error)?;
        let writer = pty.master.take_writer().map_err(pty_error)?;
        let killer = child.clone_killer();
        let id = uuid::Uuid::new_v4().to_string();
        let (events, _) = broadcast::channel(BACKLOG_MAX_CHUNKS * 2);
        let record = Arc::new(TerminalRecord {
            id: id.clone(),
            scope_key,
            lookup_key: lookup_key.clone(),
            cwd: cwd.clone(),
            shell: shell.clone(),
            master: Mutex::new(pty.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            events,
            state: Mutex::new(TerminalState {
                backlog: VecDeque::new(),
                backlog_bytes: 0,
                next_output_seq: 1,
                last_input_seq: 0,
                cols,
                rows,
                exited: None,
                last_used: Instant::now(),
            }),
        });
        self.inner
            .terminals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.clone(), record.clone());
        if let Some(lookup_key) = lookup_key {
            self.inner
                .lookup
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(lookup_key, id.clone());
        }
        spawn_reader(record.clone(), reader);
        spawn_waiter(record, child);
        Ok(CreatedTerminal {
            id,
            backend: "shell",
            cwd,
            shell: shell_label(&shell),
            reused: false,
        })
    }

    pub fn subscribe(
        &self,
        scope_key: &str,
        id: &str,
        last_sequence: Option<u64>,
    ) -> io::Result<TerminalSubscription> {
        let record = self.record(scope_key, id)?;
        let receiver = record.events.subscribe();
        let mut state = record
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.last_used = Instant::now();
        let ready = TerminalEvent::Ready {
            backend: "shell",
            id: record.id.clone(),
            cwd: record.cwd.clone(),
            shell: shell_label(&record.shell),
            next_input_seq: state.last_input_seq + 1,
        };
        let first_sequence = state
            .backlog
            .front()
            .and_then(TerminalEvent::output_sequence)
            .unwrap_or(state.next_output_seq);
        let mut initial = Vec::new();
        if last_sequence.is_some_and(|last| last.saturating_add(1) < first_sequence) {
            initial.push(TerminalEvent::Reset {
                reason: "backlog_gap",
                first_seq: first_sequence,
                next_seq: state.next_output_seq,
            });
        }
        initial.extend(
            state
                .backlog
                .iter()
                .filter(|event| {
                    event
                        .output_sequence()
                        .is_none_or(|sequence| last_sequence.is_none_or(|last| sequence > last))
                })
                .cloned(),
        );
        if let Some((exit_code, signal)) = &state.exited {
            initial.push(TerminalEvent::Exit {
                exit_code: *exit_code,
                signal: *signal,
            });
        }
        let last_initial_sequence = initial
            .iter()
            .filter_map(TerminalEvent::output_sequence)
            .max()
            .or(last_sequence)
            .unwrap_or(0);
        Ok(TerminalSubscription {
            ready,
            initial,
            receiver,
            last_initial_sequence,
        })
    }

    pub fn write_input(
        &self,
        scope_key: &str,
        id: &str,
        data: &str,
        input_sequence: Option<u64>,
    ) -> io::Result<Option<u64>> {
        let record = self.record(scope_key, id)?;
        {
            let mut state = record
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.exited.is_some() {
                return Err(invalid("Terminal has exited."));
            }
            if let Some(sequence) = input_sequence.filter(|sequence| *sequence > 0) {
                if sequence <= state.last_input_seq {
                    return Ok(Some(sequence));
                }
                state.last_input_seq = sequence;
            }
            state.last_used = Instant::now();
        }
        let mut writer = record
            .writer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        if let Some(input_sequence) = input_sequence.filter(|sequence| *sequence > 0) {
            Ok(Some(input_sequence))
        } else {
            Ok(None)
        }
    }

    pub fn resize(
        &self,
        scope_key: &str,
        id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> io::Result<()> {
        let record = self.record(scope_key, id)?;
        let mut state = record
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.exited.is_some() {
            return Ok(());
        }
        state.cols = cols.unwrap_or(state.cols).clamp(MIN_COLS, MAX_COLS);
        state.rows = rows.unwrap_or(state.rows).clamp(MIN_ROWS, MAX_ROWS);
        state.last_used = Instant::now();
        let result = record
            .master
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .resize(PtySize {
                rows: state.rows,
                cols: state.cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        result.map_err(pty_error)
    }

    pub fn close(&self, scope_key: &str, id: &str) -> io::Result<()> {
        let record = self.record(scope_key, id)?;
        self.inner
            .terminals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id);
        if let Some(lookup_key) = &record.lookup_key {
            self.inner
                .lookup
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(lookup_key);
        }
        let _ = record
            .killer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .kill();
        Ok(())
    }

    pub fn shutdown(&self) {
        let records = self
            .inner
            .terminals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .map(|(_, record)| record)
            .collect::<Vec<_>>();
        self.inner
            .lookup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        for record in records {
            let _ = record
                .killer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .kill();
        }
    }

    fn record(&self, scope_key: &str, id: &str) -> io::Result<Arc<TerminalRecord>> {
        let record = self
            .inner
            .terminals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| invalid("Terminal not found."))?;
        if record.scope_key != scope_key {
            return Err(invalid("Terminal not found for this session."));
        }
        Ok(record)
    }

    fn cleanup_exited(&self) {
        cleanup_exited_records(&self.inner);
    }
}

fn cleanup_exited_records(inner: &ManagerInner) {
    let expired = inner
        .terminals
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .filter_map(|(id, record)| {
            let state = record
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            (state.exited.is_some()
                && record.events.receiver_count() == 0
                && state.last_used.elapsed() >= EXITED_TTL)
                .then(|| id.clone())
        })
        .collect::<Vec<_>>();
    for id in expired {
        if let Some(record) = inner
            .terminals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&id)
        {
            if let Some(key) = &record.lookup_key {
                inner
                    .lookup
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(key);
            }
        }
    }
}

fn spawn_reader(record: Arc<TerminalRecord>, mut reader: Box<dyn Read + Send>) {
    std::thread::Builder::new()
        .name(format!("pico-terminal-reader-{}", record.id))
        .spawn(move || {
            let mut bytes = [0_u8; 8192];
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(length) => {
                        pending.extend_from_slice(&bytes[..length]);
                        for text in decode_utf8_chunks(&mut pending, false) {
                            publish_output(&record, text);
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        let _ = record.events.send(TerminalEvent::Error {
                            error: error.to_string(),
                        });
                        break;
                    }
                }
            }
            for text in decode_utf8_chunks(&mut pending, true) {
                publish_output(&record, text);
            }
        })
        .ok();
}

fn spawn_waiter(
    record: Arc<TerminalRecord>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) {
    std::thread::Builder::new()
        .name(format!("pico-terminal-waiter-{}", record.id))
        .spawn(move || {
            let (exit_code, signal) = match child.wait() {
                Ok(status) => (
                    status.exit_code(),
                    status.signal().and_then(portable_signal_number),
                ),
                Err(error) => {
                    let _ = record.events.send(TerminalEvent::Error {
                        error: error.to_string(),
                    });
                    (1, None)
                }
            };
            {
                let mut state = record
                    .state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.exited = Some((exit_code, signal));
                state.last_used = Instant::now();
            }
            let _ = record
                .events
                .send(TerminalEvent::Exit { exit_code, signal });
        })
        .ok();
}

fn publish_output(record: &TerminalRecord, data: String) {
    if data.is_empty() {
        return;
    }
    let event = {
        let mut state = record
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let event = TerminalEvent::Output {
            data,
            seq: state.next_output_seq,
        };
        state.next_output_seq = state.next_output_seq.saturating_add(1);
        state.backlog_bytes += event_bytes(&event);
        state.backlog.push_back(event.clone());
        while state.backlog.len() > BACKLOG_MAX_CHUNKS || state.backlog_bytes > BACKLOG_MAX_BYTES {
            let Some(removed) = state.backlog.pop_front() else {
                break;
            };
            state.backlog_bytes = state.backlog_bytes.saturating_sub(event_bytes(&removed));
        }
        state.last_used = Instant::now();
        event
    };
    let _ = record.events.send(event);
}

fn decode_utf8_chunks(pending: &mut Vec<u8>, flush: bool) -> Vec<String> {
    let mut output = Vec::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                if !text.is_empty() {
                    output.push(text.to_string());
                }
                pending.clear();
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    output.push(String::from_utf8_lossy(&pending[..valid]).into_owned());
                    pending.drain(..valid);
                    continue;
                }
                if let Some(length) = error.error_len() {
                    output.push("�".into());
                    pending.drain(..length);
                    continue;
                }
                if flush {
                    output.push(String::from_utf8_lossy(pending).into_owned());
                    pending.clear();
                }
                break;
            }
        }
    }
    output
}

fn portable_signal_number(signal: &str) -> Option<u32> {
    let normalized = signal.trim().to_ascii_lowercase();
    if let Some(number) = normalized
        .strip_prefix("signal ")
        .and_then(|number| number.parse().ok())
    {
        return Some(number);
    }
    match normalized.as_str() {
        "hangup" => Some(1),
        "interrupt" => Some(2),
        "quit" => Some(3),
        "illegal instruction" => Some(4),
        "trace/breakpoint trap" => Some(5),
        "aborted" => Some(6),
        "bus error" => Some(7),
        "floating point exception" => Some(8),
        "killed" => Some(9),
        "user defined signal 1" => Some(10),
        "segmentation fault" => Some(11),
        "user defined signal 2" => Some(12),
        "broken pipe" => Some(13),
        "alarm clock" => Some(14),
        "terminated" => Some(15),
        _ => None,
    }
}

fn configure_environment(command: &mut CommandBuilder) {
    for key in ["ZELLIJ", "ZELLIJ_SESSION_NAME", "TMUX", "TMUX_PANE"] {
        command.env_remove(key);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/sh".into())
}

fn shell_label(shell: &str) -> String {
    Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
        .to_string()
}

fn normalize_key(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(KEY_MAX_LENGTH).collect())
}

fn event_bytes(event: &TerminalEvent) -> usize {
    match event {
        TerminalEvent::Output { data, .. } => data.len(),
        _ => serde_json::to_vec(event)
            .map(|value| value.len())
            .unwrap_or(0),
    }
}

fn pty_error(error: anyhow::Error) -> io::Error {
    io::Error::other(error.to_string())
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_signal_names_preserve_numeric_terminal_contract() {
        assert_eq!(portable_signal_number("Hangup"), Some(1));
        assert_eq!(portable_signal_number("Killed"), Some(9));
        assert_eq!(portable_signal_number("Signal 15"), Some(15));
        assert_eq!(portable_signal_number("unknown"), None);
    }

    #[test]
    fn shell_environment_drops_parent_multiplexer_state() {
        let mut command = CommandBuilder::new("/bin/sh");
        command.env("ZELLIJ", "1");
        command.env("TMUX", "parent");
        configure_environment(&mut command);
        assert!(command.get_env("ZELLIJ").is_none());
        assert!(command.get_env("TMUX").is_none());
        assert_eq!(
            command.get_env("TERM").and_then(|value| value.to_str()),
            Some("xterm-256color")
        );
        assert_eq!(
            command
                .get_env("COLORTERM")
                .and_then(|value| value.to_str()),
            Some("truecolor")
        );
    }

    #[test]
    fn utf8_decoder_preserves_split_multibyte_characters() {
        let mut pending = vec![0xf0, 0x9f];
        assert!(decode_utf8_chunks(&mut pending, false).is_empty());
        pending.extend([0x98, 0x80]);
        assert_eq!(decode_utf8_chunks(&mut pending, false), vec!["😀"]);
        assert!(pending.is_empty());
    }

    #[test]
    fn backlog_is_bounded_and_reports_replay_gaps() {
        let manager = TerminalManager::default();
        let created = manager
            .create(
                "scope".into(),
                std::env::temp_dir(),
                None,
                Some(80),
                Some(24),
            )
            .expect("terminal");
        let record = manager.record("scope", &created.id).expect("record");
        for index in 0..=BACKLOG_MAX_CHUNKS {
            publish_output(&record, format!("{index}\n"));
        }
        let subscription = manager
            .subscribe("scope", &created.id, Some(0))
            .expect("subscription");
        assert!(matches!(
            subscription.initial.first(),
            Some(TerminalEvent::Reset {
                reason: "backlog_gap",
                ..
            })
        ));
        publish_output(&record, "x".repeat(BACKLOG_MAX_BYTES + 1));
        let empty_backlog_gap = manager
            .subscribe("scope", &created.id, Some(501))
            .expect("empty-backlog subscription");
        assert!(matches!(
            empty_backlog_gap.initial.first(),
            Some(TerminalEvent::Reset {
                first_seq: 503,
                next_seq: 503,
                ..
            })
        ));
        manager.shutdown();
    }

    #[test]
    fn reconnect_replays_only_unseen_monotonic_output() {
        let manager = TerminalManager::default();
        let created = manager
            .create("scope".into(), std::env::temp_dir(), None, None, None)
            .expect("terminal");
        let record = manager.record("scope", &created.id).expect("record");
        publish_output(&record, "one".into());
        publish_output(&record, "two".into());
        publish_output(&record, "three".into());
        let subscription = manager
            .subscribe("scope", &created.id, Some(1))
            .expect("subscription");
        let sequences = subscription
            .initial
            .iter()
            .filter_map(TerminalEvent::output_sequence)
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![2, 3]);
        assert_eq!(subscription.last_initial_sequence, 3);
        manager.shutdown();
    }

    #[test]
    fn slow_subscribers_do_not_block_output_and_observe_backpressure() {
        let manager = TerminalManager::default();
        let created = manager
            .create("scope".into(), std::env::temp_dir(), None, None, None)
            .expect("terminal");
        let record = manager.record("scope", &created.id).expect("record");
        let mut subscription = manager
            .subscribe("scope", &created.id, None)
            .expect("subscription");
        for index in 0..2_000 {
            publish_output(&record, index.to_string());
        }
        assert!(matches!(
            subscription.receiver.try_recv(),
            Err(broadcast::error::TryRecvError::Lagged(_))
        ));
        let state = record
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(state.backlog.len(), BACKLOG_MAX_CHUNKS);
        drop(state);
        manager.shutdown();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_survives_disconnect_and_reports_process_exit() {
        let manager = TerminalManager::default();
        let created = manager
            .create(
                "scope".into(),
                std::env::temp_dir(),
                Some("persistent"),
                None,
                None,
            )
            .expect("terminal");
        manager
            .write_input("scope", &created.id, "ignored", Some(4))
            .expect("terminal input");
        let record = manager.record("scope", &created.id).expect("record");
        publish_output(&record, "retained-output".into());
        record
            .killer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .kill()
            .expect("kill child");

        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        let subscription = loop {
            let subscription = manager
                .subscribe("scope", &created.id, None)
                .expect("late subscription");
            if subscription
                .initial
                .iter()
                .any(|event| matches!(event, TerminalEvent::Exit { .. }))
            {
                break subscription;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "terminal did not exit; events: {:?}",
                subscription.initial
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert!(subscription.initial.iter().any(|event| {
            matches!(event, TerminalEvent::Output { data, .. } if data.contains("retained-output"))
        }));
        assert!(matches!(
            subscription.ready,
            TerminalEvent::Ready {
                next_input_seq: 5,
                ..
            }
        ));
        manager.shutdown();
    }
}
