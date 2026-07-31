use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
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
use crate::persistence::{self, ServerSnapshot};
use crate::pi_rpc::{detect_pi_version, PiRpcError};
use crate::protocol::{API_CONTRACT_VERSION, PERSISTENCE_VERSION, SERVER_PROTOCOL_VERSION};
use crate::runtime::RuntimeRegistry;
use crate::security::{self, RequestPolicy};

#[derive(Clone)]
struct ServerContext {
    app: Arc<RwLock<AppState>>,
    runtimes: Arc<RuntimeRegistry>,
    started_at: Instant,
    pi_version: Option<String>,
    pi_error: Option<String>,
    control_status: Arc<RwLock<ControlStatus>>,
    previous_clean_shutdown: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    cwd: PathBuf,
    session_path: Option<PathBuf>,
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
    persistence::store(
        &config.paths.state_file,
        &ServerSnapshot::started(config.port),
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
        app: Arc::new(RwLock::new(AppState::default())),
        runtimes: Arc::new(RuntimeRegistry::new(config.pi_binary.clone())),
        started_at: Instant::now(),
        pi_version,
        pi_error,
        control_status: control_status.clone(),
        previous_clean_shutdown: previous_snapshot.map(|snapshot| snapshot.clean_shutdown),
    };
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

fn router(context: ServerContext) -> Router {
    Router::new()
        .route("/api/client/manifest", get(client_manifest))
        .route("/api/system/health", get(system_health))
        .route(
            "/api/rust/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/rust/sessions/:id", delete(delete_session))
        .route("/api/rust/sessions/:id/commands", post(send_command))
        .route("/api/rust/sessions/:id/events", get(session_events))
        .with_state(context)
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
        "events": ["pi_rpc_event"],
        "endpoints": [
          "/api/client/manifest",
          "/api/system/health",
          "/api/rust/sessions",
          "/api/rust/sessions/:id/commands",
          "/api/rust/sessions/:id/events"
        ],
        "features": [
          "rust-daemon-foundation",
          "pi-rpc-process-isolation"
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
    let record = context
        .app
        .write()
        .await
        .reserve_session(cwd.clone(), request.session_path.clone());
    context
        .runtimes
        .spawn(record.id.clone(), cwd, request.session_path.clone())
        .await?;
    context.app.write().await.insert_session(record.clone());

    Ok((
        StatusCode::CREATED,
        Json(json!({ "ok": true, "session": record })),
    ))
}

async fn delete_session(
    State(context): State<ServerContext>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !context.runtimes.remove(&id).await? {
        return Err(ApiError::not_found("session not found"));
    }
    context.app.write().await.remove_session(&id);
    Ok(Json(json!({ "ok": true })))
}

async fn send_command(
    State(context): State<ServerContext>,
    Path(id): Path<String>,
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
    Path(id): Path<String>,
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
        ServerContext {
            app: Arc::new(RwLock::new(AppState::default())),
            runtimes: Arc::new(RuntimeRegistry::new(PathBuf::from("pi"))),
            started_at: Instant::now(),
            pi_version: Some("test".into()),
            pi_error: None,
            control_status: Arc::new(RwLock::new(initial_status("127.0.0.1".into(), 3141))),
            previous_clean_shutdown: Some(true),
        }
    }

    #[tokio::test]
    async fn manifest_identifies_preview_without_claiming_full_pico_capabilities() {
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
        assert!(!manifest["capabilities"]["features"]
            .as_array()
            .expect("features")
            .iter()
            .any(|feature| feature == "conversation"));
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
