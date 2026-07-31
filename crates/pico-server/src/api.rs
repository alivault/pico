use std::collections::{BTreeSet, HashMap};
use std::convert::Infallible;
use std::io::{Read, Seek, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{watch, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::info;

use crate::app_state::AppState;
use crate::config::ServerConfig;
#[cfg(unix)]
use crate::control::ControlServer;
use crate::control::{initial_status, ControlStatus};
use crate::event_hub::{EventHub, ServerEvent};
use crate::persistence::{self, ServerSnapshot};
use crate::pi_protocol::PiCommand;
use crate::pi_rpc::{detect_pi_version, PiRpcClient, PiRpcError};
use crate::protocol::{
    ConversationItem, API_CONTRACT_VERSION, PERSISTENCE_VERSION, SERVER_PROTOCOL_VERSION,
};
use crate::runtime::RuntimeRegistry;
use crate::security::{self, RequestPolicy};
use crate::session_store::{
    streaming_assistant_item, update_streaming_tool, IndexedSessionFile, SessionDocument,
    SessionStore,
};

#[derive(Clone)]
struct ServerContext {
    app: Arc<RwLock<AppState>>,
    runtimes: Arc<RuntimeRegistry>,
    started_at: Instant,
    pi_version: Option<String>,
    pi_error: Option<String>,
    control_status: Arc<RwLock<ControlStatus>>,
    previous_clean_shutdown: Option<bool>,
    state_file: PathBuf,
    port: u16,
    event_hub: EventHub,
    session_store: Arc<SessionStore>,
    runtime_projections: Arc<RwLock<HashMap<String, RuntimeProjection>>>,
    pending_queues: Arc<RwLock<HashMap<String, Vec<PendingPrompt>>>>,
    streaming_items: Arc<RwLock<HashMap<String, ConversationItem>>>,
    hide_thinking: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Default)]
struct RuntimeProjection {
    model: Option<Value>,
    thinking_level: Option<String>,
    available_models: Vec<Value>,
    available_thinking_levels: Vec<String>,
    context_usage: Option<Value>,
    compacting: bool,
}

#[derive(Debug)]
struct StateSyncOptions<'a> {
    fallback_session_id: Option<&'a str>,
    fallback_session_key: Option<&'a str>,
    fallback_cwd: Option<&'a Path>,
    streaming: bool,
    streaming_item: Option<&'a ConversationItem>,
    projection: Option<&'a RuntimeProjection>,
    hide_thinking: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingPrompt {
    pending_id: String,
    text: String,
    images: Vec<crate::protocol::PromptImage>,
    streaming_behavior: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    cwd: PathBuf,
    session_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct DirectoryQuery {
    directory: String,
    offset: Option<usize>,
    limit: Option<usize>,
    context: Option<String>,
}

#[derive(Debug, Default)]
struct EventsQuery {
    context: String,
    session: Option<String>,
    session_key: Option<String>,
    sidebar_directories: Vec<PathBuf>,
    last_event_id: Option<u64>,
}

#[derive(Debug, Default)]
struct RequestTarget {
    context_id: String,
    session: Option<String>,
    session_path: Option<PathBuf>,
    session_key: Option<String>,
}

struct ResolvedRuntime {
    record: crate::app_state::SessionRecord,
    client: Arc<PiRpcClient>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptRequest {
    #[serde(default)]
    message: String,
    #[serde(default)]
    images: Vec<crate::protocol::PromptImage>,
    streaming_behavior: Option<String>,
    pending_id: Option<String>,
    thinking_level: Option<String>,
    draft_owner_key: Option<String>,
    draft_cwd: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionRequest {
    cwd: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRequest {
    provider: String,
    model_id: String,
}

#[derive(Debug, Deserialize)]
struct ThinkingRequest {
    level: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlashCommandRequest {
    name: String,
    #[serde(default)]
    args: String,
}

#[derive(Debug, Deserialize)]
struct SessionPathRequest {
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct RenameSessionRequest {
    path: PathBuf,
    name: String,
}

#[derive(Debug, Deserialize)]
struct DeleteSessionsRequest {
    paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct MoveSessionRequest {
    path: PathBuf,
    cwd: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ReadStateRequest {
    path: PathBuf,
    #[serde(default)]
    unread: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NavigateTreeRequest {
    target_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreeLabelRequest {
    entry_id: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingOrderItem {
    pending_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderPendingRequest {
    pending_messages: Option<Vec<PendingOrderItem>>,
    pending_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemovePendingRequest {
    pending_id: String,
}

#[derive(Debug, Deserialize)]
struct HideThinkingRequest {
    #[serde(default)]
    hide: bool,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl From<PiRpcError> for ApiError {
    fn from(error: PiRpcError) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
              "ok": false,
              "error": self.message,
            })),
        )
            .into_response()
    }
}

pub async fn serve(config: ServerConfig) -> Result<(), Box<dyn std::error::Error>> {
    config.paths.create()?;
    #[cfg(unix)]
    let control = ControlServer::bind(&config.paths.control_socket).await?;
    let previous_snapshot = persistence::load(&config.paths.state_file)?;
    let restored_sessions = previous_snapshot
        .as_ref()
        .map(|snapshot| snapshot.sessions.clone())
        .unwrap_or_default();
    persistence::store(
        &config.paths.state_file,
        &ServerSnapshot::started(config.port, restored_sessions.clone()),
    )?;

    let (pi_version, pi_error) = match detect_pi_version(&config.pi_binary).await {
        Ok(version) => (Some(version), None),
        Err(error) => (None, Some(error.to_string())),
    };
    let control_status = Arc::new(RwLock::new(initial_status(
        config.host.to_string(),
        config.port,
    )));
    let context = ServerContext {
        app: Arc::new(RwLock::new(AppState::from_sessions(restored_sessions))),
        runtimes: Arc::new(RuntimeRegistry::new(config.pi_binary.clone())),
        started_at: Instant::now(),
        pi_version,
        pi_error,
        control_status: control_status.clone(),
        previous_clean_shutdown: previous_snapshot.map(|snapshot| snapshot.clean_shutdown),
        state_file: config.paths.state_file.clone(),
        port: config.port,
        event_hub: EventHub::default(),
        session_store: Arc::new(SessionStore::new(&config.agent_dir)),
        runtime_projections: Arc::new(RwLock::new(HashMap::new())),
        pending_queues: Arc::new(RwLock::new(HashMap::new())),
        streaming_items: Arc::new(RwLock::new(HashMap::new())),
        hide_thinking: Arc::new(AtomicBool::new(false)),
    };
    restore_session_processes(&context).await;
    let policy = Arc::new(RequestPolicy::new(
        config.host,
        config.port,
        config.allowed_origins.clone(),
    ));
    let app = router(context.clone())
        .layer(DefaultBodyLimit::max(config.max_request_bytes))
        .layer(middleware::from_fn_with_state(
            policy,
            security::validate_request,
        ));
    let address = SocketAddr::new(config.host, config.port);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    #[cfg(unix)]
    let control_task = {
        let stop = shutdown_rx.clone();
        let shutdown = shutdown_tx.clone();
        Some(tokio::spawn(async move {
            control.run(control_status.clone(), shutdown, stop).await;
        }))
    };
    #[cfg(not(unix))]
    let control_task: Option<tokio::task::JoinHandle<()>> = None;

    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            let _ = shutdown_tx.send(true);
            if let Some(control_task) = control_task {
                let _ = control_task.await;
            }
            persistence::mark_clean_shutdown(&config.paths.state_file)?;
            return Err(error.into());
        }
    };
    context.control_status.write().await.phase = "running".into();
    if !config.host.is_loopback() {
        tracing::warn!(%address, "Pico is listening beyond loopback; configure authentication before using an untrusted network");
    }
    info!(%address, "native Pico server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(
            shutdown_rx,
            shutdown_tx.clone(),
            context.control_status.clone(),
        ))
        .await?;
    context.control_status.write().await.phase = "stopping".into();
    let _ = shutdown_tx.send(true);
    context.runtimes.shutdown().await;
    if let Some(control_task) = control_task {
        let _ = control_task.await;
    }
    persistence::mark_clean_shutdown(&config.paths.state_file)?;
    Ok(())
}

async fn restore_session_processes(context: &ServerContext) {
    let sessions = context.app.read().await.sessions();
    for session in sessions {
        let Some(session_path) = session.session_path.clone() else {
            continue;
        };
        match context
            .runtimes
            .spawn(session.id.clone(), session.cwd.clone(), Some(session_path))
            .await
        {
            Ok(runtime) => attach_pi_events((*context).clone(), session.id.clone(), runtime),
            Err(error) => {
                tracing::warn!(
                    %error,
                    session_id = %session.id,
                    cwd = %session.cwd.display(),
                    "failed to restore Pi session process"
                );
            }
        }
    }
}

fn attach_pi_events(context: ServerContext, session_id: String, runtime: Arc<PiRpcClient>) {
    tokio::spawn(async move {
        let completion_document = session_document_for_runtime(&context, &session_id).await;
        let persisted_pi_session_id = context
            .app
            .read()
            .await
            .sessions()
            .into_iter()
            .find(|record| record.id == session_id)
            .and_then(|record| record.pi_session_id);
        let public_session_id = completion_document
            .as_ref()
            .map(|document| document.header.id.clone())
            .or(persisted_pi_session_id)
            .unwrap_or_else(|| session_id.clone());
        let mut events = runtime.subscribe();
        let mut latest_streaming_message = None;
        let mut tool_updates = HashMap::<String, Value>::new();
        loop {
            let event = match events.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, %session_id, "Pi event consumer lagged");
                    emit_session_state(&context, &session_id, runtime.is_running(), None).await;
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            match event.get("type").and_then(Value::as_str) {
                Some("agent_start") | Some("compaction_start") => {
                    emit_session_state(&context, &session_id, true, None).await;
                }
                Some("message_update") => {
                    latest_streaming_message = event.get("message").cloned();
                    let item =
                        build_streaming_item(latest_streaming_message.as_ref(), &tool_updates);
                    if let Some(item) = &item {
                        context
                            .streaming_items
                            .write()
                            .await
                            .insert(session_id.clone(), item.clone());
                    }
                    emit_session_state(&context, &session_id, true, item).await;
                }
                Some("tool_execution_start")
                | Some("tool_execution_update")
                | Some("tool_execution_end") => {
                    if let Some(call_id) = event.get("toolCallId").and_then(Value::as_str) {
                        tool_updates.insert(call_id.to_string(), event.clone());
                    }
                    let item =
                        build_streaming_item(latest_streaming_message.as_ref(), &tool_updates);
                    if let Some(item) = &item {
                        context
                            .streaming_items
                            .write()
                            .await
                            .insert(session_id.clone(), item.clone());
                    }
                    emit_session_state(&context, &session_id, true, item).await;
                }
                Some("turn_end") => {
                    let _ = dispatch_pending_prompt(&context, &session_id, &runtime, "steer", true)
                        .await;
                }
                Some("agent_settled") | Some("compaction_end") => {
                    latest_streaming_message = None;
                    tool_updates.clear();
                    context.streaming_items.write().await.remove(&session_id);
                    maybe_auto_name_session(&context, &session_id, &runtime).await;
                    refresh_runtime_projection(&context, &session_id, &runtime).await;
                    if dispatch_pending_prompt(&context, &session_id, &runtime, "followUp", false)
                        .await
                    {
                        continue;
                    }
                    emit_session_state(&context, &session_id, false, None).await;
                    context
                        .app
                        .write()
                        .await
                        .mark_session_done(&public_session_id);
                    let done_document = session_document_for_runtime(&context, &session_id).await;
                    let completion_cwd = done_document
                        .as_ref()
                        .map(|document| document.header.cwd.clone());
                    let completion_title = done_document
                        .as_ref()
                        .map(|document| document.summary().title);
                    context.event_hub.push(
                        None,
                        Some(public_session_id.clone()),
                        json!({
                          "type": "session_done",
                          "id": format!("done:{}:{}", public_session_id, context.event_hub.current_sequence() + 1),
                          "sessionId": public_session_id,
                          "sessionKey": format!("session:{}", public_session_id),
                          "cwd": completion_cwd,
                          "title": completion_title,
                          "reason": if event["type"] == "compaction_end" { "manual_compaction" } else { "agent" },
                          "outcome": "success",
                          "completedAt": time::OffsetDateTime::now_utc()
                            .format(&time::format_description::well_known::Rfc3339)
                            .unwrap_or_default()
                        }),
                    );
                }
                Some("extension_ui_request") | Some("extension_error") => {
                    context
                        .event_hub
                        .push(None, Some(public_session_id.clone()), event);
                }
                Some("pico_pi_process_exited") => {
                    emit_session_state(&context, &session_id, false, None).await;
                    context.event_hub.push(
                        None,
                        Some(public_session_id.clone()),
                        json!({
                          "type": "request_error",
                          "scope": "pi_process",
                          "message": "Pi process exited"
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
}

async fn dispatch_pending_prompt(
    context: &ServerContext,
    runtime_id: &str,
    runtime: &PiRpcClient,
    behavior: &str,
    while_streaming: bool,
) -> bool {
    let pending = {
        let mut queues = context.pending_queues.write().await;
        let Some(queue) = queues.get_mut(runtime_id) else {
            return false;
        };
        let Some(index) = queue
            .iter()
            .position(|pending| pending.streaming_behavior == behavior)
        else {
            return false;
        };
        queue.remove(index)
    };
    let images = pending
        .images
        .iter()
        .map(|image| crate::pi_protocol::PiImage {
            kind: "image".into(),
            data: image.data.clone(),
            mime_type: image.mime_type.clone(),
        })
        .collect::<Vec<_>>();
    let command = if while_streaming {
        PiCommand::Steer {
            message: pending.text.clone(),
            images,
        }
    } else {
        PiCommand::Prompt {
            message: pending.text.clone(),
            images,
            streaming_behavior: None,
        }
    };
    let dispatched = runtime
        .request_typed(&command)
        .await
        .map_err(ApiError::from)
        .and_then(pi_response_data)
        .is_ok();
    if !dispatched {
        context
            .pending_queues
            .write()
            .await
            .entry(runtime_id.to_string())
            .or_default()
            .insert(0, pending);
        context.event_hub.push(
            None,
            None,
            json!({
              "type": "request_error",
              "scope": "pending_message",
              "message": "Failed to dispatch queued prompt"
            }),
        );
        return false;
    }
    emit_session_state(context, runtime_id, true, None).await;
    true
}

async fn maybe_auto_name_session(context: &ServerContext, runtime_id: &str, runtime: &PiRpcClient) {
    let Some(document) = session_document_for_runtime(context, runtime_id).await else {
        return;
    };
    if document.session_name().is_some() {
        return;
    }
    let first_message = document.first_user_message();
    let name = heuristic_session_name(&first_message);
    if name.is_empty() {
        return;
    }
    let result = runtime
        .request_typed(&PiCommand::SetSessionName { name: name.clone() })
        .await
        .map_err(ApiError::from)
        .and_then(pi_response_data);
    if let Err(error) = result {
        context.event_hub.push(
            None,
            Some(document.header.id.clone()),
            json!({
              "type": "auto_session_naming_error",
              "sessionId": document.header.id,
              "cwd": document.header.cwd,
              "promptPreview": truncate_chars(&first_message, 160),
              "imageCount": 0,
              "heuristicReason": error.message
            }),
        );
    }
}

fn heuristic_session_name(message: &str) -> String {
    let normalized = message
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .trim_matches(|character: char| character.is_ascii_punctuation());
    let name = normalized
        .split_whitespace()
        .take(10)
        .collect::<Vec<_>>()
        .join(" ");
    truncate_chars(&name, 48)
}

fn build_streaming_item(
    message: Option<&Value>,
    tool_updates: &HashMap<String, Value>,
) -> Option<ConversationItem> {
    let mut item = streaming_assistant_item(message?);
    for (call_id, event) in tool_updates {
        let event_type = event.get("type").and_then(Value::as_str);
        let result = event.get("result").or_else(|| event.get("partialResult"));
        update_streaming_tool(
            &mut item,
            call_id,
            result.map(content_text),
            result.and_then(|result| result.get("details")).cloned(),
            event.get("isError").and_then(Value::as_bool),
            event_type != Some("tool_execution_end"),
        );
    }
    Some(item)
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

async fn session_document_for_runtime(
    context: &ServerContext,
    runtime_id: &str,
) -> Option<SessionDocument> {
    let record = context
        .app
        .read()
        .await
        .sessions()
        .into_iter()
        .find(|record| record.id == runtime_id);
    record
        .and_then(|record| record.session_path)
        .and_then(|path| context.session_store.load(&path).ok())
}

async fn emit_session_state(
    context: &ServerContext,
    session_id: &str,
    streaming: bool,
    streaming_item: Option<ConversationItem>,
) {
    match state_payload_for_runtime(context, session_id, streaming, streaming_item).await {
        Ok(payload) => {
            let public_session_id = payload
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or(session_id)
                .to_string();
            context
                .event_hub
                .push(None, Some(public_session_id.clone()), payload);
            context.event_hub.push(
                None,
                Some(public_session_id.clone()),
                json!({
                  "type": "session_status",
                  "sessionId": public_session_id,
                  "sessionKey": format!("session:{}", public_session_id),
                  "streaming": streaming
                }),
            );
        }
        Err(error) => {
            tracing::warn!(error = %error.message, %session_id, "failed to build session state")
        }
    }
}

async fn state_payload_for_runtime(
    context: &ServerContext,
    session_id: &str,
    streaming: bool,
    streaming_item: Option<ConversationItem>,
) -> Result<Value, ApiError> {
    let record = context
        .app
        .read()
        .await
        .sessions()
        .into_iter()
        .find(|record| record.id == session_id)
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    let document = record
        .session_path
        .as_deref()
        .and_then(|path| context.session_store.load(path).ok());
    let public_session_id = document
        .as_ref()
        .map(|document| document.header.id.as_str())
        .or(record.pi_session_id.as_deref())
        .unwrap_or(session_id);
    let projection = context
        .runtime_projections
        .read()
        .await
        .get(session_id)
        .cloned();
    let retained_streaming_item = if streaming && streaming_item.is_none() {
        context
            .streaming_items
            .read()
            .await
            .get(session_id)
            .cloned()
    } else {
        None
    };
    let mut payload = build_state_sync(
        document.as_ref(),
        StateSyncOptions {
            fallback_session_id: Some(public_session_id),
            fallback_session_key: None,
            fallback_cwd: None,
            streaming,
            streaming_item: streaming_item.as_ref().or(retained_streaming_item.as_ref()),
            projection: projection.as_ref(),
            hide_thinking: context.hide_thinking.load(Ordering::Acquire),
        },
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("draft".into(), Value::Bool(record.draft));
        let pending = context
            .pending_queues
            .read()
            .await
            .get(session_id)
            .cloned()
            .unwrap_or_default();
        object.insert(
            "pendingUserMessages".into(),
            serde_json::to_value(pending).unwrap_or(Value::Array(Vec::new())),
        );
    }
    Ok(payload)
}

async fn persist_sessions(context: &ServerContext) -> Result<(), ApiError> {
    let sessions = context.app.read().await.sessions();
    let mut snapshot = persistence::load(&context.state_file)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .unwrap_or_else(|| ServerSnapshot::started(context.port, Vec::new()));
    snapshot.sessions = sessions;
    persistence::store(&context.state_file, &snapshot)
        .map_err(|error| ApiError::internal(error.to_string()))
}

fn router(context: ServerContext) -> Router {
    Router::new()
        .route("/api/client/manifest", get(client_manifest))
        .route("/api/system/health", get(system_health))
        .route("/events", get(pico_events))
        .route("/api/directory-sessions", get(directory_sessions))
        .route(
            "/api/directory-sessions-index",
            get(directory_sessions_index),
        )
        .route(
            "/api/directory-sessions-indexes",
            get(directory_sessions_indexes),
        )
        .route("/api/session/new", post(new_session))
        .route("/api/session/select", post(select_session))
        .route("/api/prompt", post(prompt))
        .route("/api/abort", post(abort))
        .route(
            "/api/pending-messages/reorder",
            post(reorder_pending_messages),
        )
        .route("/api/pending-message/remove", post(remove_pending_message))
        .route("/api/pending-messages/start", post(start_pending_queue))
        .route("/api/model", post(set_model))
        .route("/api/thinking", post(set_thinking))
        .route("/api/settings/hide-thinking", post(set_hide_thinking))
        .route("/api/slash-command", post(run_slash_command))
        .route("/api/session/history", get(session_history))
        .route("/api/session/rename", post(rename_session))
        .route("/api/session/name", post(generate_session_name))
        .route("/api/session/delete", post(delete_session_file))
        .route("/api/sessions/delete", post(delete_session_files))
        .route("/api/session/move", post(move_session))
        .route("/api/session/read-state", post(set_session_read_state))
        .route(
            "/api/session/tree",
            get(session_tree).post(navigate_session_tree),
        )
        .route("/api/session/tree/label", post(set_session_tree_label))
        .route("/api/session/fork", get(fork_messages).post(fork_session))
        .route("/api/session/clone", post(clone_session))
        .route(
            "/api/rust/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/rust/sessions/:id", delete(delete_session))
        .route("/api/rust/sessions/:id/commands", post(send_command))
        .route("/api/rust/sessions/:id/events", get(session_events))
        .with_state(context)
}

async fn pico_events(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    headers: HeaderMap,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let query = parse_events_query(raw_query.as_deref(), &headers);
    let (stored_selection, draft_session_id) = {
        let app = context.app.read().await;
        let viewer = app.context(&query.context);
        let draft_runtime_id = viewer
            .and_then(|viewer| viewer.active_draft.as_ref())
            .filter(|draft| query.session_key.as_deref() == Some(draft.session_key.as_str()))
            .and_then(|draft| draft.runtime_id.as_deref());
        let draft_session_id = draft_runtime_id.and_then(|runtime_id| {
            app.sessions()
                .into_iter()
                .find(|record| record.id == runtime_id)
                .and_then(|record| record.pi_session_id)
        });
        (
            viewer.and_then(|viewer| viewer.selected_session.clone()),
            draft_session_id,
        )
    };
    let requested_selection = query.session.clone().or(stored_selection);
    let document = match requested_selection.as_deref() {
        Some(selection) => context
            .session_store
            .find(selection)
            .map_err(|error| ApiError::internal(error.to_string()))?,
        None => None,
    };
    let selected_session_id = document
        .as_ref()
        .map(|document| document.header.id.clone())
        .or(requested_selection.clone())
        .or(draft_session_id);
    context.app.write().await.update_context(
        query.context.clone(),
        requested_selection.clone(),
        query.sidebar_directories.clone(),
    );
    let draft_cwd = query
        .session_key
        .as_deref()
        .and_then(draft_cwd_from_session_key);
    if document.is_none() {
        if let (Some(session_key), Some(cwd)) = (query.session_key.clone(), draft_cwd.clone()) {
            let runtime_id = context
                .app
                .read()
                .await
                .context(&query.context)
                .and_then(|viewer| viewer.active_draft.as_ref())
                .and_then(|draft| draft.runtime_id.clone());
            context
                .app
                .write()
                .await
                .select_draft(&query.context, session_key, cwd, runtime_id);
        }
    }

    let projection = if let Some(selected_session_id) = selected_session_id.as_deref() {
        let runtime_id = context
            .app
            .read()
            .await
            .sessions()
            .into_iter()
            .find(|record| {
                record.id == selected_session_id
                    || record.pi_session_id.as_deref() == Some(selected_session_id)
            })
            .map(|record| record.id);
        if let Some(runtime_id) = runtime_id {
            context
                .runtime_projections
                .read()
                .await
                .get(&runtime_id)
                .cloned()
        } else {
            None
        }
    } else {
        None
    };
    let state_payload = build_state_sync(
        document.as_ref(),
        StateSyncOptions {
            fallback_session_id: selected_session_id.as_deref(),
            fallback_session_key: query.session_key.as_deref(),
            fallback_cwd: draft_cwd.as_deref(),
            streaming: false,
            streaming_item: None,
            projection: projection.as_ref(),
            hide_thinking: context.hide_thinking.load(Ordering::Acquire),
        },
    );
    let unread_session_ids = context
        .app
        .read()
        .await
        .context(&query.context)
        .map(|viewer| viewer.unread_session_ids.clone())
        .unwrap_or_default();
    let sessions_payload = build_sessions_payload(
        &context,
        document.as_ref(),
        &query.sidebar_directories,
        &unread_session_ids,
    )?;
    let mut previous_items = state_payload
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let receiver = context.event_hub.subscribe();
    let mut bootstrap = Vec::new();
    if let Some(last_event_id) = query.last_event_id {
        if let Some(events) = context.event_hub.events_after(last_event_id) {
            for event in events {
                if event_matches(&event, &query.context, selected_session_id.as_deref()) {
                    bootstrap.push(Ok(sse_event(&event.payload, Some(event.sequence))));
                }
            }
        } else {
            bootstrap.push(Ok(sse_event(
                &json!({
                  "type": "request_error",
                  "scope": "events",
                  "message": "Event replay window expired; state was resynchronized"
                }),
                None,
            )));
        }
    }
    bootstrap.push(Ok(sse_event(&state_payload, None)));
    bootstrap.push(Ok(sse_event(&sessions_payload, None)));

    let context_id = query.context;
    let live_session_id = selected_session_id;
    let live = BroadcastStream::new(receiver).filter_map(move |result| match result {
        Ok(event) => {
            if !event_matches(&event, &context_id, live_session_id.as_deref()) {
                return None;
            }
            let payload = if event.payload.get("type").and_then(Value::as_str) == Some("state_sync")
            {
                patch_state_sync(&mut previous_items, &event.payload)
            } else {
                event.payload
            };
            Some(Ok(sse_event(&payload, Some(event.sequence))))
        }
        Err(error) => Some(Ok(sse_event(
            &json!({
              "type": "request_error",
              "scope": "events",
              "message": format!("SSE event gap: {error}; reconnect to resynchronize")
            }),
            None,
        ))),
    });
    let stream = tokio_stream::iter(bootstrap).chain(live);
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keepalive"),
    ))
}

async fn directory_sessions(
    State(context): State<ServerContext>,
    Query(query): Query<DirectoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let directory = normalized_directory(&query.directory)?;
    let documents = context
        .session_store
        .list_directory(&directory)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let unread_session_ids = viewer_unread_ids(&context, query.context.as_deref()).await;
    let offset = query.offset.unwrap_or(0).min(documents.len());
    let limit = query.limit.filter(|limit| *limit > 0).unwrap_or(5).min(100);
    let sessions = documents
        .iter()
        .skip(offset)
        .take(limit)
        .map(|document| session_summary(document, &unread_session_ids))
        .collect::<Vec<_>>();
    Ok(Json(json!({
      "ok": true,
      "directory": directory,
      "totalCount": documents.len(),
      "offset": offset,
      "limit": limit,
      "sessions": sessions
    })))
}

async fn directory_sessions_index(
    State(context): State<ServerContext>,
    Query(query): Query<DirectoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let directory = normalized_directory(&query.directory)?;
    let documents = context
        .session_store
        .list_directory(&directory)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let unread_session_ids = viewer_unread_ids(&context, query.context.as_deref()).await;
    Ok(Json(json!({
      "ok": true,
      "directory": directory,
      "totalCount": documents.len(),
      "revision": directory_revision(&directory, &documents, &unread_session_ids),
      "sessions": documents.iter().map(|document| session_summary(document, &unread_session_ids)).collect::<Vec<_>>()
    })))
}

async fn directory_sessions_indexes(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let directories = query_values(raw_query.as_deref(), "directory")
        .into_iter()
        .filter_map(|directory| normalized_directory(&directory).ok())
        .collect::<Vec<_>>();
    let context_id = query_values(raw_query.as_deref(), "context")
        .into_iter()
        .next();
    let unread_session_ids = viewer_unread_ids(&context, context_id.as_deref()).await;
    if directories.is_empty() {
        return Err(ApiError::bad_request("at least one directory is required"));
    }
    let mut directory_indexes = serde_json::Map::new();
    for directory in &directories {
        let documents = context
            .session_store
            .list_directory(directory)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        directory_indexes.insert(
            directory.to_string_lossy().into_owned(),
            json!({
              "directory": directory,
              "totalCount": documents.len(),
              "revision": directory_revision(directory, &documents, &unread_session_ids),
              "sessions": documents.iter().map(|document| session_summary(document, &unread_session_ids)).collect::<Vec<_>>()
            }),
        );
    }
    Ok(Json(json!({
      "ok": true,
      "directories": directories,
      "directoryIndexes": directory_indexes
    })))
}

fn build_state_sync(document: Option<&SessionDocument>, options: StateSyncOptions<'_>) -> Value {
    let mut items = document
        .map(SessionDocument::conversation_items)
        .unwrap_or_default();
    if let Some(item) = options.streaming_item {
        items.push(item.clone());
    }
    let session_id = document
        .map(|document| document.header.id.as_str())
        .or(options.fallback_session_id);
    let session_key = document
        .map(|document| format!("session:{}", document.header.id))
        .or_else(|| options.fallback_session_key.map(str::to_string))
        .or_else(|| session_id.map(|session_id| format!("session:{session_id}")))
        .unwrap_or_else(|| "draft:default".into());
    let mut payload = json!({
      "type": "state_sync",
      "sessionKey": session_key,
      "draft": document.is_none(),
      "streaming": options.streaming,
      "compacting": false,
      "pendingUserMessages": [],
      "items": items,
      "historyOffset": 0,
      "historyTotalCount": document.map(SessionDocument::message_count).unwrap_or(0),
      "hideThinkingBlock": options.hide_thinking,
      "thinkingLevel": document.and_then(SessionDocument::thinking_level).unwrap_or_else(|| "xhigh".into()),
      "availableThinkingLevels": ["off", "minimal", "low", "medium", "high", "xhigh"],
      "availableModels": [],
      "availableSkills": [],
      "firstMessage": document.map(SessionDocument::first_user_message).unwrap_or_default(),
      "uiState": {
        "statuses": {},
        "workingMessage": if options.streaming { Value::String("Working…".into()) } else { Value::Null }
      }
    });
    if let Some(object) = payload.as_object_mut() {
        if let Some(cwd) = options.fallback_cwd {
            object.insert(
                "cwd".into(),
                Value::String(cwd.to_string_lossy().into_owned()),
            );
        }
        if let Some(session_id) = session_id {
            object.insert("sessionId".into(), Value::String(session_id.into()));
        }
        if let Some(document) = document {
            object.insert(
                "sessionFile".into(),
                Value::String(document.path.to_string_lossy().into_owned()),
            );
            object.insert(
                "cwd".into(),
                Value::String(document.header.cwd.to_string_lossy().into_owned()),
            );
            if let Some(name) = document.session_name() {
                object.insert("sessionName".into(), Value::String(name));
            }
            if let Some(modified) = &document.modified {
                object.insert("modified".into(), Value::String(modified.clone()));
            }
            if let Some(model) = document.model() {
                object.insert(
                    "model".into(),
                    serde_json::to_value(model).unwrap_or(Value::Null),
                );
            }
        }
        if let Some(projection) = options.projection {
            object.insert("compacting".into(), Value::Bool(projection.compacting));
            object.insert(
                "availableModels".into(),
                Value::Array(projection.available_models.clone()),
            );
            object.insert(
                "availableThinkingLevels".into(),
                serde_json::to_value(&projection.available_thinking_levels)
                    .unwrap_or(Value::Array(Vec::new())),
            );
            if let Some(model) = &projection.model {
                object.insert("model".into(), model.clone());
            }
            if let Some(thinking_level) = &projection.thinking_level {
                object.insert(
                    "thinkingLevel".into(),
                    Value::String(thinking_level.clone()),
                );
            }
            if let Some(context_usage) = &projection.context_usage {
                object.insert("contextUsage".into(), context_usage.clone());
            }
        }
    }
    payload
}

fn build_sessions_payload(
    context: &ServerContext,
    active: Option<&SessionDocument>,
    requested_directories: &[PathBuf],
    unread_session_ids: &BTreeSet<String>,
) -> Result<Value, ApiError> {
    let indexed_sessions = context
        .session_store
        .list_index()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let mut directories = indexed_sessions
        .iter()
        .map(|indexed| indexed.header.cwd.clone())
        .collect::<Vec<_>>();
    directories.sort();
    directories.dedup();
    let mut index_directories = requested_directories.to_vec();
    if let Some(active) = active {
        index_directories.push(active.header.cwd.clone());
    }
    index_directories.sort();
    index_directories.dedup();

    let directory_states = directories
        .iter()
        .map(|directory| {
            let entries = indexed_for_directory(&indexed_sessions, directory);
            json!({
              "path": directory,
              "totalCount": entries.len(),
              "revision": indexed_directory_revision(directory, &entries, unread_session_ids)
            })
        })
        .collect::<Vec<_>>();
    let mut directory_indexes = serde_json::Map::new();
    for directory in index_directories {
        let indexed_entries = indexed_for_directory(&indexed_sessions, &directory);
        let entries = load_indexed_documents(&context.session_store, &indexed_entries);
        directory_indexes.insert(
            directory.to_string_lossy().into_owned(),
            json!({
              "directory": directory,
              "totalCount": indexed_entries.len(),
              "revision": indexed_directory_revision(&directory, &indexed_entries, unread_session_ids),
              "sessions": entries.iter().map(|document| session_summary(document, unread_session_ids)).collect::<Vec<_>>()
            }),
        );
    }
    let mut payload = json!({
      "type": "sessions",
      "directories": directories,
      "directoryStates": directory_states,
      "directoryIndexes": directory_indexes
    });
    if let Some(active) = active {
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "activeSessionPath".into(),
                Value::String(active.path.to_string_lossy().into_owned()),
            );
            object.insert(
                "activeSessionId".into(),
                Value::String(active.header.id.clone()),
            );
            object.insert(
                "activeSessionKey".into(),
                Value::String(format!("session:{}", active.header.id)),
            );
        }
    }
    Ok(payload)
}

async fn viewer_unread_ids(context: &ServerContext, context_id: Option<&str>) -> BTreeSet<String> {
    context
        .app
        .read()
        .await
        .context(context_id.unwrap_or("default"))
        .map(|viewer| viewer.unread_session_ids.clone())
        .unwrap_or_default()
}

fn session_summary(
    document: &SessionDocument,
    unread_session_ids: &BTreeSet<String>,
) -> crate::protocol::SessionListEntry {
    let mut summary = document.summary();
    summary.unread = Some(unread_session_ids.contains(&document.header.id));
    summary
}

fn patch_state_sync(previous_items: &mut Vec<Value>, payload: &Value) -> Value {
    let Some(next_items) = payload.get("items").and_then(Value::as_array) else {
        return payload.clone();
    };
    let mut start = 0;
    while start < previous_items.len()
        && start < next_items.len()
        && previous_items[start] == next_items[start]
    {
        start += 1;
    }
    let mut previous_suffix = previous_items.len();
    let mut next_suffix = next_items.len();
    while previous_suffix > start
        && next_suffix > start
        && previous_items[previous_suffix - 1] == next_items[next_suffix - 1]
    {
        previous_suffix -= 1;
        next_suffix -= 1;
    }
    let patch = json!({
      "previousLength": previous_items.len(),
      "start": start,
      "deleteCount": previous_suffix - start,
      "items": next_items[start..next_suffix]
    });
    *previous_items = next_items.clone();
    let mut result = payload.clone();
    if let Some(object) = result.as_object_mut() {
        object.remove("items");
        object.insert("itemsPatch".into(), patch);
        for key in [
            "historyOffset",
            "historyTotalCount",
            "hideThinkingBlock",
            "availableSkills",
            "firstMessage",
            "sessionId",
            "sessionFile",
            "cwd",
            "modified",
        ] {
            object.remove(key);
        }
    }
    result
}

fn parse_events_query(raw_query: Option<&str>, headers: &HeaderMap) -> EventsQuery {
    let mut query = EventsQuery {
        context: "default".into(),
        ..EventsQuery::default()
    };
    for (key, value) in url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes()) {
        match key.as_ref() {
            "context" if !value.trim().is_empty() => query.context = value.into_owned(),
            "session" if !value.trim().is_empty() => query.session = Some(value.into_owned()),
            "sessionKey" if !value.trim().is_empty() => {
                query.session_key = Some(value.into_owned());
            }
            "sidebarDirectory" if !value.trim().is_empty() => {
                query
                    .sidebar_directories
                    .push(PathBuf::from(value.into_owned()));
            }
            "lastEventId" => query.last_event_id = value.parse().ok(),
            _ => {}
        }
    }
    if let Some(last_event_id) = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
    {
        query.last_event_id = Some(last_event_id);
    }
    query
}

fn draft_cwd_from_session_key(session_key: &str) -> Option<PathBuf> {
    let cwd = session_key.strip_prefix("draft:")?.trim();
    (!cwd.is_empty() && cwd != "default").then(|| PathBuf::from(cwd))
}

fn query_values(raw_query: Option<&str>, name: &str) -> Vec<String> {
    url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes())
        .filter(|(key, value)| key == name && !value.trim().is_empty())
        .map(|(_, value)| value.into_owned())
        .collect()
}

fn normalized_directory(directory: &str) -> Result<PathBuf, ApiError> {
    let directory = directory.trim();
    if directory.is_empty() {
        return Err(ApiError::bad_request("directory is required"));
    }
    Ok(PathBuf::from(directory))
}

fn indexed_for_directory(
    indexed_sessions: &[IndexedSessionFile],
    directory: &Path,
) -> Vec<IndexedSessionFile> {
    indexed_sessions
        .iter()
        .filter(|indexed| indexed.header.cwd == directory)
        .cloned()
        .collect()
}

fn load_indexed_documents(
    session_store: &SessionStore,
    indexed_sessions: &[IndexedSessionFile],
) -> Vec<SessionDocument> {
    indexed_sessions
        .iter()
        .filter_map(|indexed| match session_store.load(&indexed.path) {
            Ok(document) => Some(document),
            Err(error) => {
                tracing::warn!(
                    %error,
                    path = %indexed.path.display(),
                    "skipping unreadable Pi session"
                );
                None
            }
        })
        .collect()
}

fn indexed_directory_revision(
    directory: &Path,
    indexed_sessions: &[IndexedSessionFile],
    unread_session_ids: &BTreeSet<String>,
) -> String {
    revision_for_sessions(
        directory,
        indexed_sessions.iter().map(|indexed| {
            (
                indexed.header.id.clone(),
                indexed.revision.clone(),
                unread_session_ids.contains(&indexed.header.id),
            )
        }),
    )
}

fn directory_revision(
    directory: &Path,
    documents: &[SessionDocument],
    unread_session_ids: &BTreeSet<String>,
) -> String {
    revision_for_sessions(
        directory,
        documents.iter().map(|document| {
            (
                document.header.id.clone(),
                document.revision(),
                unread_session_ids.contains(&document.header.id),
            )
        }),
    )
}

fn revision_for_sessions(
    directory: &Path,
    sessions: impl IntoIterator<Item = (String, String, bool)>,
) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    let mut update = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    };
    update(directory.to_string_lossy().as_bytes());
    for (id, revision, unread) in sessions {
        update(id.as_bytes());
        update(revision.as_bytes());
        update(&[u8::from(unread)]);
    }
    format!("{hash:016x}")
}

fn event_matches(event: &ServerEvent, context_id: &str, session_id: Option<&str>) -> bool {
    if event
        .context_id
        .as_deref()
        .is_some_and(|event_context| event_context != context_id)
    {
        return false;
    }
    if let Some(event_session) = event.session_id.as_deref() {
        let event_type = event.payload.get("type").and_then(Value::as_str);
        let selected_session_only = matches!(
            event_type,
            Some("state_sync")
                | Some("user_message")
                | Some("extension_ui_request")
                | Some("extension_error")
        );
        if selected_session_only {
            return session_id == Some(event_session);
        }
    }
    true
}

fn sse_event(payload: &Value, sequence: Option<u64>) -> Event {
    let event = Event::default().data(payload.to_string());
    if let Some(sequence) = sequence {
        event.id(sequence.to_string())
    } else {
        event
    }
}

async fn client_manifest() -> Json<Value> {
    Json(json!({
      "ok": true,
      "name": "@alivault/pico",
      "version": env!("CARGO_PKG_VERSION"),
      "displayName": "Pico Rust Preview",
      "apiContractVersion": API_CONTRACT_VERSION,
      "pairingRequired": false,
      "authentication": { "type": "none" },
      "transport": {
        "sse": true,
        "httpsRequired": false,
        "localHttpAllowed": true
      },
      "capabilities": {
        "events": [
          "state_sync",
          "sessions",
          "session_status",
          "session_done",
          "user_message",
          "request_error",
          "extension_error",
          "extension_ui_request"
        ],
        "endpoints": [
          "/events",
          "/api/client/manifest",
          "/api/system/health",
          "/api/directory-sessions",
          "/api/directory-sessions-index",
          "/api/directory-sessions-indexes",
          "/api/session/new",
          "/api/session/select",
          "/api/session/rename",
          "/api/session/name",
          "/api/session/delete",
          "/api/sessions/delete",
          "/api/session/move",
          "/api/session/read-state",
          "/api/session/history",
          "/api/session/tree",
          "/api/session/tree/label",
          "/api/session/fork",
          "/api/session/clone",
          "/api/prompt",
          "/api/abort",
          "/api/pending-messages/reorder",
          "/api/pending-message/remove",
          "/api/pending-messages/start",
          "/api/model",
          "/api/thinking",
          "/api/settings/hide-thinking",
          "/api/slash-command",
          "/api/rust/sessions",
          "/api/rust/sessions/:id/commands",
          "/api/rust/sessions/:id/events"
        ],
        "features": [
          "rust-daemon-foundation",
          "pi-rpc-process-isolation",
          "session-index",
          "conversation",
          "state-sync",
          "sse-replay",
          "prompt",
          "prompt-queue",
          "session-mutations",
          "session-tree",
          "model-selection",
          "thinking-selection",
          "compaction"
        ]
      }
    }))
}

async fn system_health(State(context): State<ServerContext>) -> Json<Value> {
    let phase = context.control_status.read().await.phase.clone();
    Json(json!({
      "ok": true,
      "runtime": "rust",
      "version": env!("CARGO_PKG_VERSION"),
      "serverProtocolVersion": SERVER_PROTOCOL_VERSION,
      "persistenceVersion": PERSISTENCE_VERSION,
      "phase": phase,
      "previousCleanShutdown": context.previous_clean_shutdown,
      "uptimeSeconds": context.started_at.elapsed().as_secs(),
      "pi": {
        "binary": context.runtimes.pi_binary(),
        "available": context.pi_version.is_some(),
        "version": context.pi_version,
        "error": context.pi_error,
      }
    }))
}

async fn list_sessions(State(context): State<ServerContext>) -> Json<Value> {
    let sessions = context.app.read().await.sessions();
    Json(json!({ "ok": true, "sessions": sessions }))
}

async fn new_session(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<NewSessionRequest>,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    let cwd = if let Some(cwd) = request.cwd {
        canonical_directory(&cwd)?
    } else {
        context
            .app
            .read()
            .await
            .base_cwd(&target.context_id)
            .unwrap_or(
                std::env::current_dir().map_err(|error| ApiError::internal(error.to_string()))?,
            )
    };
    let resolved = spawn_runtime(&context, cwd.clone(), None, true).await?;
    let session_key = format!("draft:{}", cwd.to_string_lossy());
    context.app.write().await.select_draft(
        &target.context_id,
        session_key.clone(),
        cwd.clone(),
        Some(resolved.record.id.clone()),
    );
    Ok(Json(json!({
      "ok": true,
      "draft": true,
      "sessionKey": session_key,
      "cwd": cwd
    })))
}

async fn select_session(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    let resolved = resolve_runtime(&context, &target, false).await?;
    let public_id = resolved
        .record
        .pi_session_id
        .clone()
        .unwrap_or_else(|| resolved.record.id.clone());
    context
        .app
        .write()
        .await
        .select_session(&target.context_id, public_id);
    emit_session_state(&context, &resolved.record.id, false, None).await;
    Ok(Json(json!({ "ok": true })))
}

async fn prompt(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<PromptRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.message.trim().is_empty() && request.images.is_empty() {
        return Err(ApiError::bad_request("message or image is required"));
    }
    let mut target = parse_request_target(raw_query.as_deref());
    if target.session_key.is_none() {
        target.session_key = request.draft_owner_key.clone();
    }
    let resolved = match resolve_runtime(&context, &target, true).await {
        Ok(resolved) => resolved,
        Err(_error) if target.session_key.is_some() && request.draft_cwd.is_some() => {
            let cwd = canonical_directory(request.draft_cwd.as_deref().unwrap_or(Path::new(".")))?;
            spawn_runtime(&context, cwd, None, true).await?
        }
        Err(error) => return Err(error),
    };
    if let Some(level) = request.thinking_level.as_deref() {
        validate_thinking_level(level)?;
        pi_response_data(
            resolved
                .client
                .request_typed(&PiCommand::SetThinkingLevel {
                    level: level.to_string(),
                })
                .await?,
        )?;
    }
    let pi_images = request
        .images
        .iter()
        .map(|image| crate::pi_protocol::PiImage {
            kind: "image".into(),
            data: image.data.clone(),
            mime_type: image.mime_type.clone(),
        })
        .collect::<Vec<_>>();
    let streaming = runtime_streaming(&resolved.client).await?;
    let behavior = match request.streaming_behavior.as_deref() {
        Some("steer") => "steer",
        Some("followUp") => "followUp",
        Some(value) => {
            return Err(ApiError::bad_request(format!(
                "invalid streaming behavior: {value}"
            )))
        }
        None if streaming => "steer",
        None => "followUp",
    };
    let pending_id = request
        .pending_id
        .clone()
        .unwrap_or_else(|| format!("pending:{}", context.event_hub.current_sequence() + 1));
    if streaming {
        context
            .pending_queues
            .write()
            .await
            .entry(resolved.record.id.clone())
            .or_default()
            .push(PendingPrompt {
                pending_id: pending_id.clone(),
                text: request.message.clone(),
                images: request.images.clone(),
                streaming_behavior: behavior.into(),
            });
        emit_session_state(&context, &resolved.record.id, true, None).await;
    } else {
        pi_response_data(
            resolved
                .client
                .request_typed(&PiCommand::Prompt {
                    message: request.message.clone(),
                    images: pi_images,
                    streaming_behavior: None,
                })
                .await?,
        )?;
    }
    if resolved.record.draft && !streaming {
        let mut promoted = resolved.record.clone();
        promoted.draft = false;
        let public_id = promoted
            .pi_session_id
            .clone()
            .unwrap_or_else(|| promoted.id.clone());
        context.app.write().await.insert_session(promoted);
        context
            .app
            .write()
            .await
            .select_session(&target.context_id, public_id);
        persist_sessions(&context).await?;
    }
    context.event_hub.push(
        Some(target.context_id),
        resolved.record.pi_session_id.clone(),
        json!({
          "type": "user_message",
          "message": request.message,
          "images": request.images,
          "queued": streaming
        }),
    );
    Ok(Json(json!({
      "ok": true,
      "queued": streaming,
      "pendingId": if streaming { Some(pending_id) } else { None }
    })))
}

async fn abort(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    pi_response_data(resolved.client.request_typed(&PiCommand::Abort).await?)?;
    Ok(Json(json!({ "ok": true })))
}

async fn reorder_pending_messages(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<ReorderPendingRequest>,
) -> Result<Json<Value>, ApiError> {
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    let order = request
        .pending_messages
        .map(|messages| {
            messages
                .into_iter()
                .map(|message| message.pending_id)
                .collect::<Vec<_>>()
        })
        .or(request.pending_ids)
        .ok_or_else(|| ApiError::bad_request("pendingMessages must be an array"))?;
    let pending_messages = {
        let mut queues = context.pending_queues.write().await;
        let queue = queues.entry(resolved.record.id.clone()).or_default();
        let unique_ids = order.iter().collect::<BTreeSet<_>>();
        if order.len() != queue.len()
            || unique_ids.len() != order.len()
            || !order.iter().all(|pending_id| {
                queue
                    .iter()
                    .any(|pending| &pending.pending_id == pending_id)
            })
        {
            return Err(ApiError::bad_request(
                "pendingMessages must include every queued prompt exactly once",
            ));
        }
        let mut remaining = std::mem::take(queue)
            .into_iter()
            .map(|pending| (pending.pending_id.clone(), pending))
            .collect::<HashMap<_, _>>();
        *queue = order
            .into_iter()
            .filter_map(|pending_id| remaining.remove(&pending_id))
            .collect();
        queue.clone()
    };
    emit_session_state(
        &context,
        &resolved.record.id,
        runtime_streaming(&resolved.client).await?,
        None,
    )
    .await;
    Ok(Json(
        json!({ "ok": true, "pendingMessages": pending_messages }),
    ))
}

async fn remove_pending_message(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<RemovePendingRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.pending_id.is_empty() {
        return Err(ApiError::bad_request("pendingId is required"));
    }
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    let removed = {
        let mut queues = context.pending_queues.write().await;
        let queue = queues.entry(resolved.record.id.clone()).or_default();
        let previous_length = queue.len();
        queue.retain(|pending| pending.pending_id != request.pending_id);
        queue.len() != previous_length
    };
    if !removed {
        return Err(ApiError::not_found("Pending prompt not found"));
    }
    emit_session_state(
        &context,
        &resolved.record.id,
        runtime_streaming(&resolved.client).await?,
        None,
    )
    .await;
    Ok(Json(json!({ "ok": true, "pendingId": request.pending_id })))
}

async fn start_pending_queue(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    if runtime_streaming(&resolved.client).await? {
        return Err(ApiError::bad_request(
            "Wait for the current response to finish before starting the queue.",
        ));
    }
    let behavior = context
        .pending_queues
        .read()
        .await
        .get(&resolved.record.id)
        .and_then(|queue| queue.first())
        .map(|pending| pending.streaming_behavior.clone());
    if let Some(behavior) = behavior {
        let _ = dispatch_pending_prompt(
            &context,
            &resolved.record.id,
            &resolved.client,
            &behavior,
            false,
        )
        .await;
    }
    let pending_messages = context
        .pending_queues
        .read()
        .await
        .get(&resolved.record.id)
        .cloned()
        .unwrap_or_default();
    Ok(Json(
        json!({ "ok": true, "pendingMessages": pending_messages }),
    ))
}

async fn set_model(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<ModelRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.provider.trim().is_empty() || request.model_id.trim().is_empty() {
        return Err(ApiError::bad_request("provider and modelId are required"));
    }
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), true).await?;
    pi_response_data(
        resolved
            .client
            .request_typed(&PiCommand::SetModel {
                provider: request.provider.clone(),
                model_id: request.model_id.clone(),
            })
            .await?,
    )?;
    let state = pi_response_data(resolved.client.request_typed(&PiCommand::GetState).await?)?;
    refresh_runtime_projection(&context, &resolved.record.id, &resolved.client).await;
    emit_session_state(&context, &resolved.record.id, false, None).await;
    Ok(Json(json!({
      "ok": true,
      "model": state.get("model"),
      "thinkingLevel": state.get("thinkingLevel"),
      "availableThinkingLevels": available_thinking_levels(&resolved.client).await?
    })))
}

async fn set_thinking(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<ThinkingRequest>,
) -> Result<Json<Value>, ApiError> {
    validate_thinking_level(&request.level)?;
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), true).await?;
    pi_response_data(
        resolved
            .client
            .request_typed(&PiCommand::SetThinkingLevel {
                level: request.level.clone(),
            })
            .await?,
    )?;
    refresh_runtime_projection(&context, &resolved.record.id, &resolved.client).await;
    emit_session_state(&context, &resolved.record.id, false, None).await;
    Ok(Json(json!({
      "ok": true,
      "thinkingLevel": request.level,
      "availableThinkingLevels": available_thinking_levels(&resolved.client).await?
    })))
}

async fn set_hide_thinking(
    State(context): State<ServerContext>,
    Json(request): Json<HideThinkingRequest>,
) -> Json<Value> {
    context.hide_thinking.store(request.hide, Ordering::Release);
    let runtime_ids = context
        .app
        .read()
        .await
        .sessions()
        .into_iter()
        .map(|record| record.id)
        .collect::<Vec<_>>();
    for runtime_id in runtime_ids {
        let streaming = if let Some(client) = context.runtimes.get(&runtime_id).await {
            runtime_streaming(&client).await.unwrap_or(false)
        } else {
            false
        };
        emit_session_state(&context, &runtime_id, streaming, None).await;
    }
    Json(json!({ "ok": true, "hideThinkingBlock": request.hide }))
}

async fn run_slash_command(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<SlashCommandRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = request.name.trim().trim_start_matches('/');
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), true).await?;
    if name == "compact" {
        let custom_instructions =
            (!request.args.trim().is_empty()).then(|| request.args.trim().to_string());
        pi_response_data(
            resolved
                .client
                .request_typed(&PiCommand::Compact {
                    custom_instructions,
                })
                .await?,
        )?;
    } else {
        let message = if request.args.trim().is_empty() {
            format!("/{name}")
        } else {
            format!("/{name} {}", request.args.trim())
        };
        pi_response_data(
            resolved
                .client
                .request_typed(&PiCommand::Prompt {
                    message,
                    images: Vec::new(),
                    streaming_behavior: None,
                })
                .await?,
        )?;
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct HistoryQuery {
    before: Option<usize>,
    limit: Option<usize>,
}

async fn session_history(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    let document = resolve_session_document(&context, &target).await?;
    let messages = document.messages();
    let total_count = messages.len();
    let limit = query
        .limit
        .filter(|limit| *limit > 0)
        .unwrap_or(50)
        .min(200);
    let before = query.before.unwrap_or(total_count).min(total_count);
    let offset = before.saturating_sub(limit);
    Ok(Json(json!({
      "ok": true,
      "offset": offset,
      "limit": limit,
      "totalCount": total_count,
      "hasMoreBefore": offset > 0,
      "messages": &messages[offset..before]
    })))
}

async fn rename_session(
    State(context): State<ServerContext>,
    Json(request): Json<RenameSessionRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let path = validated_session_path(&context, &request.path)?;
    if let Some(record) = record_for_path(&context, &path).await {
        if let Some(client) = context.runtimes.get(&record.id).await {
            pi_response_data(
                client
                    .request_typed(&PiCommand::SetSessionName {
                        name: truncate_chars(name, 48),
                    })
                    .await?,
            )?;
        } else {
            append_session_entry(
                &context
                    .session_store
                    .load(&path)
                    .map_err(|error| ApiError::internal(error.to_string()))?,
                json!({"type":"session_info", "name": truncate_chars(name, 48)}),
                None,
            )?;
        }
    } else {
        let document = context
            .session_store
            .load(&path)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        append_session_entry(
            &document,
            json!({"type":"session_info", "name": truncate_chars(name, 48)}),
            None,
        )?;
    }
    broadcast_sessions_changed(&context)?;
    Ok(Json(json!({ "ok": true, "name": name })))
}

async fn generate_session_name(
    State(context): State<ServerContext>,
    Json(request): Json<SessionPathRequest>,
) -> Result<Json<Value>, ApiError> {
    let path = validated_session_path(&context, &request.path)?;
    let document = context
        .session_store
        .load(&path)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let name = heuristic_session_name(&document.first_user_message());
    if name.is_empty() {
        return Err(ApiError::bad_request(
            "Could not generate a session name from an empty conversation",
        ));
    }
    if let Some(record) = record_for_path(&context, &path).await {
        if let Some(client) = context.runtimes.get(&record.id).await {
            pi_response_data(
                client
                    .request_typed(&PiCommand::SetSessionName { name: name.clone() })
                    .await?,
            )?;
        } else {
            append_session_entry(
                &document,
                json!({"type":"session_info", "name": name}),
                None,
            )?;
        }
    } else {
        append_session_entry(
            &document,
            json!({"type":"session_info", "name": name}),
            None,
        )?;
    }
    broadcast_sessions_changed(&context)?;
    Ok(Json(json!({
      "ok": true,
      "name": name,
      "source": "heuristic",
      "reason": "Native heuristic fallback"
    })))
}

async fn delete_session_file(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<SessionPathRequest>,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    delete_one_session(&context, &request.path).await?;
    context.app.write().await.set_session_read(
        &target.context_id,
        &request.path.to_string_lossy(),
        true,
    );
    broadcast_sessions_changed(&context)?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_session_files(
    State(context): State<ServerContext>,
    Json(request): Json<DeleteSessionsRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.paths.is_empty() {
        return Err(ApiError::bad_request("paths must not be empty"));
    }
    let mut deleted_paths = Vec::new();
    for path in request.paths {
        delete_one_session(&context, &path).await?;
        deleted_paths.push(path);
    }
    broadcast_sessions_changed(&context)?;
    Ok(Json(json!({ "ok": true, "deletedPaths": deleted_paths })))
}

async fn move_session(
    State(context): State<ServerContext>,
    Json(request): Json<MoveSessionRequest>,
) -> Result<Json<Value>, ApiError> {
    let previous_path = validated_session_path(&context, &request.path)?;
    let next_cwd = canonical_directory(&request.cwd)?;
    let document = context
        .session_store
        .load(&previous_path)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let previous_cwd = document.header.cwd.clone();
    let loaded_record = record_for_path(&context, &previous_path).await;
    if let Some(record) = &loaded_record {
        if let Some(client) = context.runtimes.get(&record.id).await {
            if runtime_streaming(&client).await? {
                return Err(ApiError::bad_request(
                    "Wait for the session to finish before moving it.",
                ));
            }
            context.runtimes.remove(&record.id).await?;
        }
    }
    let next_path = move_session_file(&previous_path, &next_cwd, context.session_store.root())?;
    if let Some(mut record) = loaded_record {
        record.cwd = next_cwd.clone();
        record.session_path = Some(next_path.clone());
        context.app.write().await.insert_session(record.clone());
        let _ = start_runtime_record(&context, record).await?;
    }
    broadcast_sessions_changed(&context)?;
    Ok(Json(json!({
      "ok": true,
      "previousPath": previous_path,
      "previousCwd": previous_cwd,
      "path": next_path,
      "cwd": next_cwd,
      "sessionId": document.header.id
    })))
}

async fn set_session_read_state(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<ReadStateRequest>,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    let path = validated_session_path(&context, &request.path)?;
    let document = context
        .session_store
        .load(&path)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    context.app.write().await.set_session_read(
        &target.context_id,
        &document.header.id,
        !request.unread,
    );
    context.event_hub.push(
        Some(target.context_id.clone()),
        None,
        json!({
          "type": "session_status",
          "sessionPath": path,
          "sessionId": document.header.id,
          "sessionKey": format!("session:{}", document.header.id),
          "unread": request.unread,
          "streaming": false
        }),
    );
    broadcast_sessions_changed(&context)?;
    Ok(Json(
        json!({ "ok": true, "path": path, "unread": request.unread }),
    ))
}

async fn navigate_session_tree(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<NavigateTreeRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.target_id.trim().is_empty() {
        return Err(ApiError::bad_request("targetId is required"));
    }
    let target = parse_request_target(raw_query.as_deref());
    let resolved = resolve_runtime(&context, &target, false).await?;
    if runtime_streaming(&resolved.client).await? {
        return Err(ApiError::bad_request(
            "Wait for the session to finish before navigating the tree.",
        ));
    }
    let document = resolved
        .record
        .session_path
        .as_deref()
        .and_then(|path| context.session_store.load(path).ok())
        .ok_or_else(|| ApiError::not_found("session file not found"))?;
    if !document
        .entries
        .iter()
        .any(|entry| entry.get("id").and_then(Value::as_str) == Some(request.target_id.as_str()))
    {
        return Err(ApiError::not_found("tree target not found"));
    }
    context.runtimes.remove(&resolved.record.id).await?;
    append_session_entry(
        &document,
        json!({
          "type": "custom",
          "customType": "pico-tree-navigation",
          "data": {"targetId": request.target_id}
        }),
        Some(request.target_id.clone()),
    )?;
    let restarted = start_runtime_record(&context, resolved.record).await?;
    emit_session_state(&context, &restarted.record.id, false, None).await;
    Ok(Json(json!({
      "ok": true,
      "cancelled": false,
      "aborted": false,
      "editorText": null
    })))
}

async fn set_session_tree_label(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<TreeLabelRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.entry_id.trim().is_empty() {
        return Err(ApiError::bad_request("entryId is required"));
    }
    let target = parse_request_target(raw_query.as_deref());
    let resolved = resolve_runtime(&context, &target, false).await?;
    if runtime_streaming(&resolved.client).await? {
        return Err(ApiError::bad_request(
            "Wait for the session to finish before changing a label.",
        ));
    }
    let document = resolved
        .record
        .session_path
        .as_deref()
        .and_then(|path| context.session_store.load(path).ok())
        .ok_or_else(|| ApiError::not_found("session file not found"))?;
    if !document
        .entries
        .iter()
        .any(|entry| entry.get("id").and_then(Value::as_str) == Some(request.entry_id.as_str()))
    {
        return Err(ApiError::not_found("tree entry not found"));
    }
    context.runtimes.remove(&resolved.record.id).await?;
    let mut label_entry = json!({
      "type": "label",
      "targetId": request.entry_id
    });
    if let Some(label) = request
        .label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
        label_entry["label"] = Value::String(label.into());
    }
    append_session_entry(&document, label_entry, None)?;
    let restarted = start_runtime_record(&context, resolved.record).await?;
    let tree = pi_response_data(restarted.client.request_typed(&PiCommand::GetTree).await?)?;
    Ok(Json(json!({
      "ok": true,
      "leafId": tree.get("leafId"),
      "streamingEntryId": null,
      "tree": tree.get("tree").cloned().unwrap_or_else(|| json!([]))
    })))
}

async fn session_tree(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    let data = pi_response_data(resolved.client.request_typed(&PiCommand::GetTree).await?)?;
    Ok(Json(json!({
      "ok": true,
      "leafId": data.get("leafId"),
      "streamingEntryId": if runtime_streaming(&resolved.client).await? { data.get("leafId").cloned() } else { None },
      "tree": data.get("tree").cloned().unwrap_or_else(|| json!([]))
    })))
}

async fn fork_messages(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let resolved =
        resolve_runtime(&context, &parse_request_target(raw_query.as_deref()), false).await?;
    let data = pi_response_data(
        resolved
            .client
            .request_typed(&PiCommand::GetForkMessages)
            .await?,
    )?;
    Ok(Json(json!({
      "ok": true,
      "messages": data.get("messages").cloned().unwrap_or_else(|| json!([]))
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForkRequest {
    entry_id: String,
}

async fn fork_session(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
    Json(request): Json<ForkRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.entry_id.trim().is_empty() {
        return Err(ApiError::bad_request("entryId is required"));
    }
    let target = parse_request_target(raw_query.as_deref());
    let resolved = resolve_runtime(&context, &target, false).await?;
    let previous_session_file = resolved.record.session_path.clone();
    let data = pi_response_data(
        resolved
            .client
            .request_typed(&PiCommand::Fork {
                entry_id: request.entry_id,
            })
            .await?,
    )?;
    refresh_runtime_record(&context, &resolved.record.id, &resolved.client).await?;
    let record = runtime_record(&context, &resolved.record.id)
        .await
        .ok_or_else(|| ApiError::internal("forked runtime record disappeared"))?;
    Ok(Json(json!({
      "ok": true,
      "cancelled": data.get("cancelled").and_then(Value::as_bool).unwrap_or(false),
      "draft": false,
      "previousSessionFile": previous_session_file,
      "sessionId": record.pi_session_id,
      "sessionFile": record.session_path
    })))
}

async fn clone_session(
    State(context): State<ServerContext>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<Value>, ApiError> {
    let target = parse_request_target(raw_query.as_deref());
    let resolved = resolve_runtime(&context, &target, false).await?;
    let previous_session_file = resolved.record.session_path.clone();
    let data = pi_response_data(resolved.client.request_typed(&PiCommand::Clone).await?)?;
    refresh_runtime_record(&context, &resolved.record.id, &resolved.client).await?;
    let record = runtime_record(&context, &resolved.record.id)
        .await
        .ok_or_else(|| ApiError::internal("cloned runtime record disappeared"))?;
    Ok(Json(json!({
      "ok": true,
      "cancelled": data.get("cancelled").and_then(Value::as_bool).unwrap_or(false),
      "draft": false,
      "previousSessionFile": previous_session_file,
      "sessionId": record.pi_session_id,
      "sessionFile": record.session_path
    })))
}

fn validated_session_path(context: &ServerContext, path: &Path) -> Result<PathBuf, ApiError> {
    let path = std::fs::canonicalize(path)
        .map_err(|error| ApiError::bad_request(format!("invalid session path: {error}")))?;
    let root = std::fs::canonicalize(context.session_store.root())
        .map_err(|error| ApiError::internal(format!("invalid session root: {error}")))?;
    if !path.starts_with(&root)
        || path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
    {
        return Err(ApiError::bad_request(
            "session path is outside the Pi session directory",
        ));
    }
    Ok(path)
}

async fn record_for_path(
    context: &ServerContext,
    path: &Path,
) -> Option<crate::app_state::SessionRecord> {
    context
        .app
        .read()
        .await
        .sessions()
        .into_iter()
        .find(|record| record.session_path.as_deref() == Some(path))
}

async fn delete_one_session(context: &ServerContext, path: &Path) -> Result<(), ApiError> {
    let path = validated_session_path(context, path)?;
    if let Some(record) = record_for_path(context, &path).await {
        if let Some(client) = context.runtimes.get(&record.id).await {
            if runtime_streaming(&client).await? {
                return Err(ApiError::bad_request(
                    "Wait for the session to finish before deleting it.",
                ));
            }
        }
        context.runtimes.remove(&record.id).await?;
        context.runtime_projections.write().await.remove(&record.id);
        context.pending_queues.write().await.remove(&record.id);
        context.streaming_items.write().await.remove(&record.id);
        context.app.write().await.remove_session(&record.id);
        persist_sessions(context).await?;
    }
    trash_or_delete_file(&path).map_err(|error| ApiError::internal(error.to_string()))
}

fn trash_or_delete_file(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let trash = PathBuf::from(home).join(".Trash");
            std::fs::create_dir_all(&trash)?;
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("pico-session.jsonl");
            let target = trash.join(format!(
                "{}.{}-{}",
                file_name,
                std::process::id(),
                time::OffsetDateTime::now_utc().unix_timestamp_nanos()
            ));
            match std::fs::rename(path, target) {
                Ok(()) => return Ok(()),
                Err(error) if error.raw_os_error() == Some(libc::EXDEV) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error),
            }
        }
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn move_session_file(
    source: &Path,
    next_cwd: &Path,
    sessions_root: &Path,
) -> Result<PathBuf, ApiError> {
    let safe_path = format!(
        "--{}--",
        next_cwd
            .to_string_lossy()
            .trim_start_matches(['/', '\\'])
            .replace(['/', '\\', ':'], "-")
    );
    let target_directory = sessions_root.join(safe_path);
    std::fs::create_dir_all(&target_directory)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let file_name = source
        .file_name()
        .ok_or_else(|| ApiError::bad_request("invalid session file name"))?;
    let mut target = target_directory.join(file_name);
    if target.exists() && target != source {
        let stem = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("session");
        target = target_directory.join(format!(
            "{}-{}.jsonl",
            stem,
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
    }
    let content =
        std::fs::read_to_string(source).map_err(|error| ApiError::internal(error.to_string()))?;
    let (header_line, remainder) = content
        .split_once('\n')
        .ok_or_else(|| ApiError::bad_request("invalid session file"))?;
    let mut header: Value = serde_json::from_str(header_line)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    header["cwd"] = Value::String(next_cwd.to_string_lossy().into_owned());
    let next_content = format!("{}\n{}", header, remainder);
    if target == source {
        std::fs::write(source, next_content)
            .map_err(|error| ApiError::internal(error.to_string()))?;
    } else {
        let mut target_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        if let Err(error) = target_file.write_all(next_content.as_bytes()) {
            let _ = std::fs::remove_file(&target);
            return Err(ApiError::internal(error.to_string()));
        }
        std::fs::remove_file(source).map_err(|error| ApiError::internal(error.to_string()))?;
    }
    Ok(target)
}

fn append_session_entry(
    document: &SessionDocument,
    mut entry: Value,
    parent_override: Option<String>,
) -> Result<(), ApiError> {
    let object = entry
        .as_object_mut()
        .ok_or_else(|| ApiError::internal("session entry must be an object"))?;
    let sequence = time::OffsetDateTime::now_utc().unix_timestamp_nanos();
    object.insert("id".into(), Value::String(format!("pico-{sequence:x}")));
    object.insert(
        "parentId".into(),
        parent_override
            .or_else(|| document.leaf_id.clone())
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    object.insert(
        "timestamp".into(),
        Value::String(
            time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        ),
    );
    let mut needs_newline = false;
    if let Ok(mut file) = std::fs::File::open(&document.path) {
        if file.metadata().map(|metadata| metadata.len()).unwrap_or(0) > 0 {
            file.seek(std::io::SeekFrom::End(-1))
                .map_err(|error| ApiError::internal(error.to_string()))?;
            let mut byte = [0_u8; 1];
            file.read_exact(&mut byte)
                .map_err(|error| ApiError::internal(error.to_string()))?;
            needs_newline = byte[0] != b'\n';
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&document.path)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if needs_newline {
        file.write_all(b"\n")
            .map_err(|error| ApiError::internal(error.to_string()))?;
    }
    serde_json::to_writer(&mut file, &entry)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    file.write_all(b"\n")
        .map_err(|error| ApiError::internal(error.to_string()))?;
    file.sync_data()
        .map_err(|error| ApiError::internal(error.to_string()))
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn broadcast_sessions_changed(context: &ServerContext) -> Result<(), ApiError> {
    let payload = build_sessions_payload(context, None, &[], &BTreeSet::new())?;
    context.event_hub.push(None, None, payload);
    Ok(())
}

fn parse_request_target(raw_query: Option<&str>) -> RequestTarget {
    let mut target = RequestTarget {
        context_id: "default".into(),
        ..RequestTarget::default()
    };
    for (key, value) in url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes()) {
        if value.trim().is_empty() {
            continue;
        }
        match key.as_ref() {
            "context" => target.context_id = value.into_owned(),
            "session" => target.session = Some(value.into_owned()),
            "sessionPath" => target.session_path = Some(PathBuf::from(value.into_owned())),
            "sessionKey" => target.session_key = Some(value.into_owned()),
            _ => {}
        }
    }
    target
}

fn canonical_directory(path: &Path) -> Result<PathBuf, ApiError> {
    let cwd = std::fs::canonicalize(path).map_err(|error| {
        ApiError::bad_request(format!("invalid cwd {}: {error}", path.display()))
    })?;
    if !cwd.is_dir() {
        return Err(ApiError::bad_request("cwd must be a directory"));
    }
    Ok(cwd)
}

async fn runtime_record(
    context: &ServerContext,
    runtime_id: &str,
) -> Option<crate::app_state::SessionRecord> {
    context
        .app
        .read()
        .await
        .sessions()
        .into_iter()
        .find(|record| record.id == runtime_id)
}

async fn resolve_runtime(
    context: &ServerContext,
    target: &RequestTarget,
    allow_draft: bool,
) -> Result<ResolvedRuntime, ApiError> {
    let (context_selection, draft_runtime_id, base_cwd) = {
        let app = context.app.read().await;
        let viewer = app.context(&target.context_id);
        (
            viewer.and_then(|viewer| viewer.selected_session.clone()),
            viewer
                .and_then(|viewer| viewer.active_draft.as_ref())
                .and_then(|draft| draft.runtime_id.clone()),
            app.base_cwd(&target.context_id),
        )
    };
    let selection = target
        .session_path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .or_else(|| target.session.clone())
        .or(context_selection);
    let records = context.app.read().await.sessions();
    let selected_record = if let Some(runtime_id) =
        draft_runtime_id.filter(|_| target.session_key.is_some() && target.session.is_none())
    {
        records
            .iter()
            .find(|record| record.id == runtime_id)
            .cloned()
    } else {
        selection.as_deref().and_then(|selection| {
            records
                .iter()
                .find(|record| {
                    record.id == selection
                        || record.pi_session_id.as_deref() == Some(selection)
                        || record
                            .session_path
                            .as_ref()
                            .is_some_and(|path| path.to_string_lossy().as_ref() == selection)
                })
                .cloned()
        })
    };

    if let Some(record) = selected_record {
        if let Some(client) = context.runtimes.get(&record.id).await {
            return Ok(ResolvedRuntime { record, client });
        }
        return start_runtime_record(context, record).await;
    }

    if let Some(selection) = selection {
        let document = context
            .session_store
            .find(&selection)
            .map_err(|error| ApiError::internal(error.to_string()))?
            .ok_or_else(|| ApiError::not_found(format!("Unknown session: {selection}")))?;
        let mut record = context
            .app
            .write()
            .await
            .reserve_session(document.header.cwd.clone(), Some(document.path.clone()));
        record.pi_session_id = Some(document.header.id.clone());
        let resolved = start_runtime_record(context, record).await?;
        context
            .app
            .write()
            .await
            .select_session(&target.context_id, document.header.id);
        return Ok(resolved);
    }

    if !allow_draft {
        return Err(ApiError::bad_request("session is required"));
    }
    let cwd = target
        .session_key
        .as_deref()
        .and_then(draft_cwd_from_session_key)
        .or(base_cwd)
        .unwrap_or(std::env::current_dir().map_err(|error| ApiError::internal(error.to_string()))?);
    let resolved = spawn_runtime(context, canonical_directory(&cwd)?, None, true).await?;
    let session_key = target
        .session_key
        .clone()
        .unwrap_or_else(|| format!("draft:{}", cwd.to_string_lossy()));
    context.app.write().await.select_draft(
        &target.context_id,
        session_key,
        cwd,
        Some(resolved.record.id.clone()),
    );
    Ok(resolved)
}

async fn resolve_session_document(
    context: &ServerContext,
    target: &RequestTarget,
) -> Result<SessionDocument, ApiError> {
    let context_selection = context
        .app
        .read()
        .await
        .context(&target.context_id)
        .and_then(|viewer| viewer.selected_session.clone());
    let selection = target
        .session_path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .or_else(|| target.session.clone())
        .or(context_selection)
        .ok_or_else(|| ApiError::bad_request("session is required"))?;
    context
        .session_store
        .find(&selection)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found(format!("Unknown session: {selection}")))
}

async fn spawn_runtime(
    context: &ServerContext,
    cwd: PathBuf,
    session_path: Option<PathBuf>,
    draft: bool,
) -> Result<ResolvedRuntime, ApiError> {
    let mut record = context.app.write().await.reserve_session(cwd, session_path);
    record.draft = draft;
    start_runtime_record(context, record).await
}

async fn start_runtime_record(
    context: &ServerContext,
    mut record: crate::app_state::SessionRecord,
) -> Result<ResolvedRuntime, ApiError> {
    let client = context
        .runtimes
        .spawn(
            record.id.clone(),
            record.cwd.clone(),
            record.session_path.clone(),
        )
        .await?;
    let state = match client.request_typed(&PiCommand::GetState).await {
        Ok(response) => pi_response_data(response),
        Err(error) => Err(error.into()),
    };
    let data = match state {
        Ok(data) => data,
        Err(error) => {
            let _ = context.runtimes.remove(&record.id).await;
            return Err(error);
        }
    };
    apply_pi_state_to_record(&mut record, &data);
    context.app.write().await.insert_session(record.clone());
    refresh_runtime_projection(context, &record.id, &client).await;
    attach_pi_events(context.clone(), record.id.clone(), client.clone());
    persist_sessions(context).await?;
    Ok(ResolvedRuntime { record, client })
}

async fn refresh_runtime_record(
    context: &ServerContext,
    runtime_id: &str,
    client: &PiRpcClient,
) -> Result<(), ApiError> {
    let data = pi_response_data(client.request_typed(&PiCommand::GetState).await?)?;
    let mut record = runtime_record(context, runtime_id)
        .await
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    apply_pi_state_to_record(&mut record, &data);
    context.app.write().await.insert_session(record);
    persist_sessions(context).await
}

fn apply_pi_state_to_record(record: &mut crate::app_state::SessionRecord, data: &Value) {
    if let Some(session_file) = data.get("sessionFile").and_then(Value::as_str) {
        record.session_path = Some(PathBuf::from(session_file));
    }
    if let Some(session_id) = data.get("sessionId").and_then(Value::as_str) {
        record.pi_session_id = Some(session_id.to_string());
    }
}

fn pi_response_data(response: Value) -> Result<Value, ApiError> {
    if response.get("success").and_then(Value::as_bool) != Some(true) {
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Pi RPC request failed");
        return Err(ApiError {
            status: StatusCode::BAD_GATEWAY,
            message: message.to_string(),
        });
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

async fn refresh_runtime_projection(
    context: &ServerContext,
    runtime_id: &str,
    client: &PiRpcClient,
) {
    let (state, models, levels, stats) = tokio::join!(
        client.request_typed(&PiCommand::GetState),
        client.request_typed(&PiCommand::GetAvailableModels),
        client.request_typed(&PiCommand::GetAvailableThinkingLevels),
        client.request_typed(&PiCommand::GetSessionStats),
    );
    let data = |response: Result<Value, PiRpcError>| {
        response
            .ok()
            .and_then(|response| pi_response_data(response).ok())
    };
    let state = data(state);
    let models = data(models);
    let levels = data(levels);
    let stats = data(stats);
    let projection = RuntimeProjection {
        model: state.as_ref().and_then(|state| state.get("model")).cloned(),
        thinking_level: state
            .as_ref()
            .and_then(|state| state.get("thinkingLevel"))
            .and_then(Value::as_str)
            .map(str::to_string),
        available_models: models
            .as_ref()
            .and_then(|models| models.get("models"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        available_thinking_levels: levels
            .as_ref()
            .and_then(|levels| levels.get("levels"))
            .and_then(Value::as_array)
            .map(|levels| {
                levels
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_else(|| {
                vec![
                    "off".into(),
                    "minimal".into(),
                    "low".into(),
                    "medium".into(),
                    "high".into(),
                    "xhigh".into(),
                ]
            }),
        context_usage: stats
            .as_ref()
            .and_then(|stats| stats.get("contextUsage"))
            .cloned(),
        compacting: state
            .as_ref()
            .and_then(|state| state.get("isCompacting"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    context
        .runtime_projections
        .write()
        .await
        .insert(runtime_id.to_string(), projection);
}

async fn runtime_streaming(client: &PiRpcClient) -> Result<bool, ApiError> {
    let data = pi_response_data(client.request_typed(&PiCommand::GetState).await?)?;
    Ok(data
        .get("isStreaming")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

async fn available_thinking_levels(client: &PiRpcClient) -> Result<Value, ApiError> {
    let data = pi_response_data(
        client
            .request_typed(&PiCommand::GetAvailableThinkingLevels)
            .await?,
    )?;
    Ok(data
        .get("levels")
        .cloned()
        .unwrap_or_else(|| json!(["off", "minimal", "low", "medium", "high", "xhigh"])))
}

fn validate_thinking_level(level: &str) -> Result<(), ApiError> {
    const LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh"];
    if LEVELS.contains(&level) {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!(
            "Invalid thinking level: {}",
            if level.is_empty() { "(empty)" } else { level }
        )))
    }
}

async fn create_session(
    State(context): State<ServerContext>,
    Json(request): Json<CreateSessionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let cwd = std::fs::canonicalize(&request.cwd).map_err(|error| {
        ApiError::bad_request(format!("invalid cwd {}: {error}", request.cwd.display()))
    })?;
    if !cwd.is_dir() {
        return Err(ApiError::bad_request("cwd must be a directory"));
    }
    let mut record = context
        .app
        .write()
        .await
        .reserve_session(cwd.clone(), request.session_path.clone());
    let runtime = context
        .runtimes
        .spawn(record.id.clone(), cwd, request.session_path.clone())
        .await?;
    match runtime.request_typed(&PiCommand::GetState).await {
        Ok(state) => {
            if let Some(data) = state.get("data") {
                if let Some(session_file) = data.get("sessionFile").and_then(Value::as_str) {
                    record.session_path = Some(PathBuf::from(session_file));
                }
                record.pi_session_id = data
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }
        Err(error) => {
            let _ = context.runtimes.remove(&record.id).await;
            return Err(error.into());
        }
    }
    context.app.write().await.insert_session(record.clone());
    attach_pi_events(context.clone(), record.id.clone(), runtime);
    persist_sessions(&context).await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "ok": true, "session": record })),
    ))
}

async fn delete_session(
    State(context): State<ServerContext>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    if !context.runtimes.remove(&id).await? {
        return Err(ApiError::not_found("session not found"));
    }
    context.runtime_projections.write().await.remove(&id);
    context.pending_queues.write().await.remove(&id);
    context.streaming_items.write().await.remove(&id);
    context.app.write().await.remove_session(&id);
    persist_sessions(&context).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn send_command(
    State(context): State<ServerContext>,
    AxumPath(id): AxumPath<String>,
    Json(command): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let runtime = context
        .runtimes
        .get(&id)
        .await
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    Ok(Json(runtime.request(command).await?))
}

async fn session_events(
    State(context): State<ServerContext>,
    AxumPath(id): AxumPath<String>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let runtime = context
        .runtimes
        .get(&id)
        .await
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    let stream = BroadcastStream::new(runtime.subscribe()).filter_map(|result| match result {
        Ok(value) => Some(Ok(Event::default()
            .event("pi_rpc_event")
            .data(value.to_string()))),
        Err(error) => Some(Ok(Event::default()
            .event("pico_event_gap")
            .data(json!({ "error": error.to_string() }).to_string()))),
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn shutdown_signal(
    mut shutdown: watch::Receiver<bool>,
    shutdown_tx: watch::Sender<bool>,
    status: Arc<RwLock<ControlStatus>>,
) {
    if !*shutdown.borrow() {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() {
                    tracing::warn!("shutdown control channel closed");
                }
            }
            _ = os_shutdown_signal() => {
                let _ = shutdown_tx.send(true);
            }
        }
    }
    status.write().await.phase = "draining".into();
    info!("native Pico server shutting down");
}

async fn os_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    result = tokio::signal::ctrl_c() => {
                        if let Err(error) = result {
                            tracing::warn!(%error, "failed to install Ctrl-C handler");
                        }
                    }
                    _ = terminate.recv() => {}
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to install SIGTERM handler");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    fn test_context() -> ServerContext {
        test_context_with_agent(Path::new("/tmp/pico-agent-test"))
    }

    fn test_context_with_agent(agent_dir: &Path) -> ServerContext {
        test_context_with_runtime(agent_dir, PathBuf::from("pi"))
    }

    fn test_context_with_runtime(agent_dir: &Path, pi_binary: PathBuf) -> ServerContext {
        ServerContext {
            app: Arc::new(RwLock::new(AppState::default())),
            runtimes: Arc::new(RuntimeRegistry::new(pi_binary)),
            started_at: Instant::now(),
            pi_version: Some("test".into()),
            pi_error: None,
            control_status: Arc::new(RwLock::new(initial_status("127.0.0.1".into(), 3141))),
            previous_clean_shutdown: Some(true),
            state_file: PathBuf::from("/tmp/pico-server-api-test-state.json"),
            port: 3141,
            event_hub: EventHub::default(),
            session_store: Arc::new(SessionStore::new(agent_dir)),
            runtime_projections: Arc::new(RwLock::new(HashMap::new())),
            pending_queues: Arc::new(RwLock::new(HashMap::new())),
            streaming_items: Arc::new(RwLock::new(HashMap::new())),
            hide_thinking: Arc::new(AtomicBool::new(false)),
        }
    }

    #[tokio::test]
    async fn manifest_advertises_the_completed_session_sync_phase() {
        let response = router(test_context())
            .oneshot(
                Request::builder()
                    .uri("/api/client/manifest")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let manifest: Value = serde_json::from_slice(&body).expect("manifest JSON");
        assert_eq!(manifest["displayName"], "Pico Rust Preview");
        assert!(manifest["capabilities"]["features"]
            .as_array()
            .expect("features")
            .iter()
            .any(|feature| feature == "pi-rpc-process-isolation"));
        assert!(manifest["capabilities"]["features"]
            .as_array()
            .expect("features")
            .iter()
            .any(|feature| feature == "conversation"));
        assert!(manifest["capabilities"]["endpoints"]
            .as_array()
            .expect("endpoints")
            .iter()
            .any(|endpoint| endpoint == "/events"));
    }

    #[test]
    fn follow_up_state_sync_uses_the_shared_items_patch_contract() {
        let initial: Value = serde_json::from_str(include_str!(
            "../../../apps/apple/Fixtures/state_sync_initial.json"
        ))
        .expect("initial fixture");
        let expected: Value = serde_json::from_str(include_str!(
            "../../../apps/apple/Fixtures/state_sync_patch.json"
        ))
        .expect("patch fixture");
        let mut previous = initial["items"].as_array().expect("initial items").clone();
        let mut next = json!({
          "type": "state_sync",
          "sessionKey": "session:demo",
          "streaming": false,
          "items": previous
        });
        next["items"] = json!([
            initial["items"][0].clone(),
            expected["itemsPatch"]["items"][0].clone()
        ]);
        assert_eq!(patch_state_sync(&mut previous, &next), expected);
    }

    #[tokio::test]
    async fn directory_index_and_sse_bootstrap_use_pi_session_files() {
        let root =
            std::env::temp_dir().join(format!("pico-api-session-test-{}", std::process::id()));
        let sessions = root.join("sessions/project");
        std::fs::create_dir_all(&sessions).expect("create sessions");
        let path = sessions.join("demo.jsonl");
        std::fs::write(
            &path,
            [
                json!({
                  "type":"session", "version":3, "id":"demo",
                  "timestamp":"2026-07-31T00:00:00.000Z", "cwd":"/tmp/project"
                }),
                json!({
                  "type":"message", "id":"u1", "parentId":null,
                  "timestamp":"2026-07-31T00:00:01.000Z",
                  "message":{"role":"user","content":"Build Pico","timestamp":1}
                }),
            ]
            .into_iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join("\n"),
        )
        .expect("write session");
        let context = test_context_with_agent(&root);

        let directory_query: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("directory", "/tmp/project")
            .finish();
        let response = router(context.clone())
            .oneshot(
                Request::builder()
                    .uri(format!("/api/directory-sessions-index?{directory_query}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let index: Value = serde_json::from_slice(&body).expect("index JSON");
        assert_eq!(index["totalCount"], 1);
        assert_eq!(index["sessions"][0]["id"], "demo");
        assert_eq!(index["sessions"][0]["title"], "Build Pico");

        let response = router(context)
            .oneshot(
                Request::builder()
                    .uri("/events?context=test&session=demo")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let mut stream = response.into_body().into_data_stream();
        let first = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("SSE timeout")
            .expect("SSE frame")
            .expect("SSE body");
        let second = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("SSE timeout")
            .expect("SSE frame")
            .expect("SSE body");
        let bootstrap = format!(
            "{}{}",
            String::from_utf8_lossy(&first),
            String::from_utf8_lossy(&second)
        );
        assert!(bootstrap.contains("\"type\":\"state_sync\""));
        assert!(bootstrap.contains("\"type\":\"sessions\""));
        assert!(bootstrap.contains("Build Pico"));
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn session_and_prompt_routes_work_with_a_deterministic_fake_pi() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "pico-api-fake-pi-{}-{}",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        let cwd = root.join("project");
        let session_directory = root.join("agent/sessions/fake");
        std::fs::create_dir_all(&cwd).expect("create cwd");
        std::fs::create_dir_all(&session_directory).expect("create sessions");
        let session_path = session_directory.join("fake.jsonl");
        let script_path = root.join("fake-pi.py");
        let script = r#"#!/usr/bin/env python3
import json, sys
from pathlib import Path
session = Path(__SESSION__)
cwd = __CWD__
session.write_text(json.dumps({"type":"session","version":3,"id":"fake-session","timestamp":"2026-07-31T00:00:00.000Z","cwd":cwd}) + "\n")
for line in sys.stdin:
    request = json.loads(line)
    command = request["type"]
    response = {"type":"response","id":request.get("id"),"command":command,"success":True}
    if command == "get_state":
        response["data"] = {"sessionFile":str(session),"sessionId":"fake-session","isStreaming":False,"isCompacting":False,"thinkingLevel":"high","model":{"id":"fake-model","provider":"fake","name":"Fake Model","reasoning":True}}
    elif command == "get_available_models":
        response["data"] = {"models":[{"id":"fake-model","provider":"fake","name":"Fake Model","reasoning":True}]}
    elif command == "get_available_thinking_levels":
        response["data"] = {"levels":["low","high"]}
    elif command == "get_session_stats":
        response["data"] = {"contextUsage":{"tokens":10,"contextWindow":100,"percent":10}}
    elif command == "get_tree":
        response["data"] = {"tree":[],"leafId":"a1"}
    elif command == "get_fork_messages":
        response["data"] = {"messages":[{"entryId":"u1","text":"hello"}]}
    print(json.dumps(response), flush=True)
    if command == "prompt":
        with session.open("a") as file:
            file.write(json.dumps({"type":"message","id":"u1","parentId":None,"timestamp":"2026-07-31T00:00:01.000Z","message":{"role":"user","content":request["message"],"timestamp":1}}) + "\n")
            file.write(json.dumps({"type":"message","id":"a1","parentId":"u1","timestamp":"2026-07-31T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"fake reply"}],"provider":"fake","model":"fake-model","stopReason":"stop","timestamp":2}}) + "\n")
        print(json.dumps({"type":"agent_start"}), flush=True)
        print(json.dumps({"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"fake reply"}],"provider":"fake","model":"fake-model","timestamp":2}}), flush=True)
        print(json.dumps({"type":"agent_settled"}), flush=True)
"#
        .replace("__SESSION__", &format!("{:?}", session_path.to_string_lossy()))
        .replace("__CWD__", &format!("{:?}", cwd.to_string_lossy()));
        std::fs::write(&script_path, script).expect("write fake Pi");
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .expect("make fake Pi executable");
        let context = test_context_with_runtime(&root.join("agent"), script_path);

        let response = router(context.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/session/new?context=fake")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({"cwd": cwd}).to_string()))
                    .expect("request"),
            )
            .await
            .expect("new session response");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("new session body");
        let created: Value = serde_json::from_slice(&body).expect("new session JSON");
        assert_eq!(created["ok"], true);
        assert_eq!(created["draft"], true);

        let prompt_query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("context", "fake")
            .append_pair(
                "sessionKey",
                created["sessionKey"].as_str().expect("session key"),
            )
            .finish();
        let response = router(context.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/prompt?{prompt_query}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({"message":"hello"}).to_string()))
                    .expect("request"),
            )
            .await
            .expect("prompt response");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("prompt body");
        let prompted: Value = serde_json::from_slice(&body).expect("prompt JSON");
        assert_eq!(prompted["ok"], true);
        assert_eq!(prompted["queued"], false);

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let response = router(context.clone())
            .oneshot(
                Request::builder()
                    .uri("/api/session/history?context=fake&session=fake-session")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("history response");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("history body");
        let history: Value = serde_json::from_slice(&body).expect("history JSON");
        assert_eq!(history["totalCount"], 2);
        assert_eq!(history["messages"][1]["content"][0]["text"], "fake reply");

        context.runtimes.shutdown().await;
        std::fs::remove_dir_all(root).expect("remove fake Pi fixture");
    }

    #[tokio::test]
    async fn health_reports_rust_and_pi_status() {
        let response = router(test_context())
            .oneshot(
                Request::builder()
                    .uri("/api/system/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let health: Value = serde_json::from_slice(&body).expect("health JSON");
        assert_eq!(health["runtime"], "rust");
        assert_eq!(health["pi"]["available"], true);
    }
}
