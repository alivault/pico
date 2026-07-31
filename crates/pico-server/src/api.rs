use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::info;

use crate::app_state::AppState;
use crate::pi_rpc::{detect_pi_version, PiRpcError};
use crate::protocol::{API_CONTRACT_VERSION, PERSISTENCE_VERSION, SERVER_PROTOCOL_VERSION};
use crate::runtime::RuntimeRegistry;

#[derive(Clone)]
struct ServerContext {
    app: Arc<RwLock<AppState>>,
    runtimes: Arc<RuntimeRegistry>,
    started_at: Instant,
    pi_version: Option<String>,
    pi_error: Option<String>,
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

pub async fn serve(
    address: SocketAddr,
    pi_binary: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let (pi_version, pi_error) = match detect_pi_version(&pi_binary).await {
        Ok(version) => (Some(version), None),
        Err(error) => (None, Some(error.to_string())),
    };
    let context = ServerContext {
        app: Arc::new(RwLock::new(AppState::default())),
        runtimes: Arc::new(RuntimeRegistry::new(pi_binary)),
        started_at: Instant::now(),
        pi_version,
        pi_error,
    };
    let app = router(context.clone());
    let listener = TcpListener::bind(address).await?;
    info!(%address, "native Pico server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    context.runtimes.shutdown().await;
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
    Json(json!({
      "ok": true,
      "runtime": "rust",
      "version": env!("CARGO_PKG_VERSION"),
      "serverProtocolVersion": SERVER_PROTOCOL_VERSION,
      "persistenceVersion": PERSISTENCE_VERSION,
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

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let terminate = signal(SignalKind::terminate());
        match terminate {
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

    info!("native Pico server shutting down");
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
