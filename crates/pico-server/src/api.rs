use std::collections::{BTreeSet, HashMap};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
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
        let completion_cwd = completion_document
            .as_ref()
            .map(|document| document.header.cwd.clone());
        let completion_title = completion_document
            .as_ref()
            .map(|document| document.summary().title);
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
                Some("message_start")
                    if event
                        .get("message")
                        .and_then(|message| message.get("role"))
                        .and_then(Value::as_str)
                        == Some("user") =>
                {
                    let message = event.get("message").unwrap_or(&Value::Null);
                    context.event_hub.push(
                        None,
                        Some(public_session_id.clone()),
                        json!({
                          "type": "user_message",
                          "message": content_text(message),
                          "images": [],
                          "queued": false
                        }),
                    );
                }
                Some("message_update") => {
                    latest_streaming_message = event.get("message").cloned();
                    emit_session_state(
                        &context,
                        &session_id,
                        true,
                        build_streaming_item(latest_streaming_message.as_ref(), &tool_updates),
                    )
                    .await;
                }
                Some("tool_execution_start")
                | Some("tool_execution_update")
                | Some("tool_execution_end") => {
                    if let Some(call_id) = event.get("toolCallId").and_then(Value::as_str) {
                        tool_updates.insert(call_id.to_string(), event.clone());
                    }
                    emit_session_state(
                        &context,
                        &session_id,
                        true,
                        build_streaming_item(latest_streaming_message.as_ref(), &tool_updates),
                    )
                    .await;
                }
                Some("agent_settled") | Some("compaction_end") => {
                    latest_streaming_message = None;
                    tool_updates.clear();
                    emit_session_state(&context, &session_id, false, None).await;
                    context
                        .app
                        .write()
                        .await
                        .mark_session_done(&public_session_id);
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
    Ok(build_state_sync(
        document.as_ref(),
        Some(public_session_id),
        None,
        None,
        streaming,
        streaming_item.as_ref(),
    ))
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
    let stored_selection = context
        .app
        .read()
        .await
        .context(&query.context)
        .and_then(|viewer| viewer.selected_session.clone());
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
        .or(requested_selection.clone());
    context.app.write().await.update_context(
        query.context.clone(),
        selected_session_id.clone(),
        query.sidebar_directories.clone(),
    );
    let draft_cwd = query
        .session_key
        .as_deref()
        .and_then(draft_cwd_from_session_key);
    if document.is_none() {
        if let (Some(session_key), Some(cwd)) = (query.session_key.clone(), draft_cwd.clone()) {
            context
                .app
                .write()
                .await
                .select_draft(&query.context, session_key, cwd);
        }
    }

    let state_payload = build_state_sync(
        document.as_ref(),
        selected_session_id.as_deref(),
        query.session_key.as_deref(),
        draft_cwd.as_deref(),
        false,
        None,
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

fn build_state_sync(
    document: Option<&SessionDocument>,
    fallback_session_id: Option<&str>,
    fallback_session_key: Option<&str>,
    fallback_cwd: Option<&Path>,
    streaming: bool,
    streaming_item: Option<&ConversationItem>,
) -> Value {
    let mut items = document
        .map(SessionDocument::conversation_items)
        .unwrap_or_default();
    if let Some(item) = streaming_item {
        items.push(item.clone());
    }
    let session_id = document
        .map(|document| document.header.id.as_str())
        .or(fallback_session_id);
    let session_key = document
        .map(|document| format!("session:{}", document.header.id))
        .or_else(|| fallback_session_key.map(str::to_string))
        .or_else(|| session_id.map(|session_id| format!("session:{session_id}")))
        .unwrap_or_else(|| "draft:default".into());
    let mut payload = json!({
      "type": "state_sync",
      "sessionKey": session_key,
      "draft": document.is_none(),
      "streaming": streaming,
      "compacting": false,
      "pendingUserMessages": [],
      "items": items,
      "historyOffset": 0,
      "historyTotalCount": document.map(SessionDocument::message_count).unwrap_or(0),
      "hideThinkingBlock": false,
      "thinkingLevel": document.and_then(SessionDocument::thinking_level).unwrap_or_else(|| "xhigh".into()),
      "availableThinkingLevels": ["off", "minimal", "low", "medium", "high", "xhigh"],
      "availableModels": [],
      "availableSkills": [],
      "firstMessage": document.map(SessionDocument::first_user_message).unwrap_or_default(),
      "uiState": {
        "statuses": {},
        "workingMessage": if streaming { Value::String("Working…".into()) } else { Value::Null }
      }
    });
    if let Some(object) = payload.as_object_mut() {
        if let Some(cwd) = fallback_cwd {
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
            "draft",
            "pendingUserMessages",
            "historyOffset",
            "historyTotalCount",
            "hideThinkingBlock",
            "thinkingLevel",
            "availableThinkingLevels",
            "availableModels",
            "availableSkills",
            "firstMessage",
            "sessionId",
            "sessionFile",
            "sessionName",
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
          "sse-replay"
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
        ServerContext {
            app: Arc::new(RwLock::new(AppState::default())),
            runtimes: Arc::new(RuntimeRegistry::new(PathBuf::from("pi"))),
            started_at: Instant::now(),
            pi_version: Some("test".into()),
            pi_error: None,
            control_status: Arc::new(RwLock::new(initial_status("127.0.0.1".into(), 3141))),
            previous_clean_shutdown: Some(true),
            state_file: PathBuf::from("/tmp/pico-server-api-test-state.json"),
            port: 3141,
            event_hub: EventHub::default(),
            session_store: Arc::new(SessionStore::new(agent_dir)),
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
