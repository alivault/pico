use std::io::{BufRead, BufReader};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow};
use reqwest::blocking::{Client, Response};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use smol::channel::Sender;
use url::Url;

use crate::models::{
    AuthProvidersResponse, ClientManifest, DesktopEvent, GitActionResponse, GitChangesResponse,
    GitFileDiffResponse, GitStatusResponse, PendingMessage, ProjectFileReadResponse,
    ProjectFileTreeResponse, PromptRequest,
};

#[derive(Clone)]
pub struct PicoClient {
    base_url: Url,
    context_id: String,
    http: Client,
    stream_generation: Arc<AtomicU64>,
}

impl PicoClient {
    pub fn new(base_url: &str, context_id: String) -> Result<Self> {
        let base_url = Url::parse(base_url).context("invalid PICO_SERVER_URL")?;
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .build()?;
        Ok(Self {
            base_url,
            context_id,
            http,
            stream_generation: Arc::new(AtomicU64::new(0)),
        })
    }

    pub fn connect(&self, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .get_json::<ClientManifest>("/api/client/manifest", &[])
                .and_then(|manifest| {
                    if !manifest.ok || manifest.api_contract_version != 1 {
                        return Err(anyhow!("unsupported Pico server API contract"));
                    }
                    tx.send_blocking(DesktopEvent::Connected(manifest))
                        .map_err(|_| anyhow!("desktop event channel closed"))
                });
            if let Err(error) = result {
                let _ = tx.send_blocking(DesktopEvent::Error(error.to_string()));
            }
        });
    }

    pub fn start_events(
        &self,
        session_id: Option<String>,
        session_key: Option<String>,
        directories: Vec<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let generation = self.stream_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let client = self.clone();
        std::thread::spawn(move || {
            while client.stream_generation.load(Ordering::SeqCst) == generation {
                let result = client.stream_once(
                    generation,
                    session_id.as_deref(),
                    session_key.as_deref(),
                    &directories,
                    &tx,
                );
                if client.stream_generation.load(Ordering::SeqCst) != generation {
                    break;
                }
                if let Err(error) = result {
                    let _ = tx.send_blocking(DesktopEvent::Error(format!(
                        "Live updates disconnected: {error}"
                    )));
                }
                std::thread::sleep(Duration::from_millis(900));
            }
        });
    }

    fn stream_once(
        &self,
        generation: u64,
        session_id: Option<&str>,
        session_key: Option<&str>,
        directories: &[String],
        tx: &Sender<DesktopEvent>,
    ) -> Result<()> {
        let mut url = self.endpoint("/events")?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("context", &self.context_id);
            if let Some(session_id) = session_id {
                query.append_pair("session", session_id);
            }
            if let Some(session_key) = session_key {
                query.append_pair("sessionKey", session_key);
            }
            for directory in directories {
                query.append_pair("sidebarDirectory", directory);
            }
        }
        let response = self
            .http
            .get(url)
            .header("accept", "text/event-stream")
            .send()?
            .error_for_status()?;
        self.read_sse(response, generation, tx)
    }

    fn read_sse(
        &self,
        response: Response,
        generation: u64,
        tx: &Sender<DesktopEvent>,
    ) -> Result<()> {
        for line in BufReader::new(response).lines() {
            if self.stream_generation.load(Ordering::SeqCst) != generation {
                return Ok(());
            }
            let line = line?;
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let value: Value = serde_json::from_str(data.trim())?;
            let event = match value.get("type").and_then(Value::as_str) {
                Some("state_sync") => Some(DesktopEvent::State(serde_json::from_value(value)?)),
                Some("sessions") => Some(DesktopEvent::Sessions(serde_json::from_value(value)?)),
                Some("conversation_delta") => {
                    Some(DesktopEvent::Delta(serde_json::from_value(value)?))
                }
                Some("git_changed") => value
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(|cwd| DesktopEvent::GitRefresh(cwd.to_string())),
                Some("extension_ui_request") => {
                    Some(DesktopEvent::UiRequest(serde_json::from_value(value)?))
                }
                Some("request_error" | "extension_error") => Some(DesktopEvent::Error(
                    value
                        .get("error")
                        .or_else(|| value.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Pico request failed")
                        .to_string(),
                )),
                _ => None,
            };
            if let Some(event) = event
                && tx.send_blocking(event).is_err()
            {
                return Ok(());
            }
        }
        Ok(())
    }

    pub fn load_auth_providers(&self, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .get_json::<AuthProvidersResponse>("/api/auth/providers", &[])
                .map(DesktopEvent::AuthProviders);
            Self::send_result(tx, result);
        });
    }

    pub fn save_api_key(&self, provider: String, key: String, tx: Sender<DesktopEvent>) {
        self.auth_mutation(
            "/api/auth/api-key",
            json!({ "provider": provider, "key": key }),
            "Saved provider API key",
            tx,
        );
    }

    pub fn login_oauth(&self, provider: String, tx: Sender<DesktopEvent>) {
        self.auth_mutation(
            "/api/auth/oauth",
            json!({ "provider": provider }),
            "Provider login completed",
            tx,
        );
    }

    pub fn logout_provider(&self, provider: String, tx: Sender<DesktopEvent>) {
        self.auth_mutation(
            "/api/auth/logout",
            json!({ "provider": provider }),
            "Logged out provider",
            tx,
        );
    }

    fn auth_mutation(
        &self,
        endpoint: &'static str,
        body: Value,
        message: &'static str,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .post_json::<Value, _>(endpoint, &[], &body)
                .map(|_| DesktopEvent::AuthChanged(message.into()));
            Self::send_result(tx, result);
        });
    }

    pub fn resolve_ui_request(&self, id: String, body: Value, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let endpoint = format!("/api/ui/{id}");
            let result = client
                .post_json::<Value, _>(&endpoint, &[], &body)
                .map(|_| DesktopEvent::UiRequestResolved);
            Self::send_result(tx, result);
        });
    }

    pub fn select_session(
        &self,
        session_id: String,
        session_path: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = vec![("session", session_id.as_str())];
            if let Some(session_path) = session_path.as_deref() {
                query.push(("sessionPath", session_path));
            }
            let result = client
                .post_json::<Value, _>("/api/session/select", &query, &json!({}))
                .map(|_| DesktopEvent::SessionSelected(session_id));
            Self::send_result(tx, result);
        });
    }

    pub fn resolve_directory(&self, path: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .post_json::<Value, _>("/api/directory/resolve", &[], &json!({ "path": path }))
                .and_then(|value| {
                    value
                        .get("path")
                        .and_then(Value::as_str)
                        .map(|path| DesktopEvent::DirectoryResolved(path.to_string()))
                        .ok_or_else(|| anyhow!("directory response omitted path"))
                });
            Self::send_result(tx, result);
        });
    }

    pub fn rename_session(&self, path: String, name: String, tx: Sender<DesktopEvent>) {
        self.session_action(
            "/api/session/rename",
            json!({ "path": path, "name": name }),
            "Renamed session",
            false,
            None,
            tx,
        );
    }

    pub fn delete_session(&self, path: String, tx: Sender<DesktopEvent>) {
        self.session_action(
            "/api/session/delete",
            json!({ "path": path }),
            "Deleted session",
            true,
            None,
            tx,
        );
    }

    pub fn clone_session(&self, session_id: String, tx: Sender<DesktopEvent>) {
        self.session_action(
            "/api/session/clone",
            json!({}),
            "Cloned session",
            false,
            Some(session_id),
            tx,
        );
    }

    pub fn set_session_unread(&self, path: String, unread: bool, tx: Sender<DesktopEvent>) {
        self.session_action(
            "/api/session/read-state",
            json!({ "path": path, "unread": unread }),
            if unread {
                "Marked session unread"
            } else {
                "Marked session read"
            },
            false,
            None,
            tx,
        );
    }

    pub fn move_session(&self, path: String, cwd: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .post_json::<Value, _>(
                    "/api/session/move",
                    &[],
                    &json!({ "path": path, "cwd": cwd }),
                )
                .and_then(|value| {
                    Ok(DesktopEvent::SessionMoved {
                        path: value
                            .get("path")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("move response omitted path"))?
                            .to_string(),
                        cwd: value
                            .get("cwd")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("move response omitted cwd"))?
                            .to_string(),
                    })
                });
            Self::send_result(tx, result);
        });
    }

    fn session_action(
        &self,
        endpoint: &'static str,
        body: Value,
        message: &'static str,
        clear_selection: bool,
        session_id: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = Vec::new();
            if let Some(session_id) = session_id.as_deref() {
                query.push(("session", session_id));
            }
            let result = client
                .post_json::<Value, _>(endpoint, &query, &body)
                .map(|_| DesktopEvent::SessionAction {
                    message: message.into(),
                    clear_selection,
                });
            Self::send_result(tx, result);
        });
    }

    pub fn create_session(&self, cwd: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .post_json::<Value, _>("/api/session/new", &[], &json!({ "cwd": cwd }))
                .and_then(|value| {
                    Ok(DesktopEvent::SessionCreated {
                        session_key: value
                            .get("sessionKey")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("new session response omitted sessionKey"))?
                            .to_string(),
                        cwd: value
                            .get("cwd")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("new session response omitted cwd"))?
                            .to_string(),
                    })
                });
            Self::send_result(tx, result);
        });
    }

    pub fn submit_prompt(
        &self,
        message: String,
        streaming_behavior: String,
        images: Vec<Value>,
        session_id: Option<String>,
        session_key: Option<String>,
        cwd: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = Vec::new();
            if let Some(session_id) = session_id.as_deref() {
                query.push(("session", session_id));
            }
            if let Some(session_key) = session_key.as_deref() {
                query.push(("sessionKey", session_key));
            }
            let body = PromptRequest {
                message: &message,
                images,
                streaming_behavior: &streaming_behavior,
                draft_owner_key: session_key.as_deref(),
                draft_cwd: cwd.as_deref(),
            };
            let result = client
                .post_json::<Value, _>("/api/prompt", &query, &body)
                .map(|_| DesktopEvent::PromptSent);
            Self::send_result(tx, result);
        });
    }

    pub fn reorder_pending_messages(
        &self,
        pending_messages: Vec<PendingMessage>,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let query = Self::session_query(session_id.as_deref(), session_key.as_deref());
            let result = client
                .post_json::<Value, _>(
                    "/api/pending-messages/reorder",
                    &query,
                    &json!({ "pendingMessages": pending_messages }),
                )
                .and_then(Self::pending_messages_event);
            Self::send_result(tx, result);
        });
    }

    pub fn remove_pending_message(
        &self,
        pending_id: String,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let query = Self::session_query(session_id.as_deref(), session_key.as_deref());
            let result = client
                .post_json::<Value, _>(
                    "/api/pending-message/remove",
                    &query,
                    &json!({ "pendingId": pending_id }),
                )
                .map(|_| DesktopEvent::PromptSent);
            Self::send_result(tx, result);
        });
    }

    pub fn start_pending_messages(
        &self,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let query = Self::session_query(session_id.as_deref(), session_key.as_deref());
            let result = client
                .post_json::<Value, _>("/api/pending-messages/start", &query, &json!({}))
                .and_then(Self::pending_messages_event);
            Self::send_result(tx, result);
        });
    }

    fn session_query<'a>(
        session_id: Option<&'a str>,
        session_key: Option<&'a str>,
    ) -> Vec<(&'static str, &'a str)> {
        let mut query = Vec::new();
        if let Some(session_id) = session_id {
            query.push(("session", session_id));
        }
        if let Some(session_key) = session_key {
            query.push(("sessionKey", session_key));
        }
        query
    }

    fn pending_messages_event(value: Value) -> Result<DesktopEvent> {
        let pending_messages = serde_json::from_value(
            value
                .get("pendingMessages")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )?;
        Ok(DesktopEvent::PendingMessages(pending_messages))
    }

    pub fn abort(
        &self,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = Vec::new();
            if let Some(session_id) = session_id.as_deref() {
                query.push(("session", session_id));
            }
            if let Some(session_key) = session_key.as_deref() {
                query.push(("sessionKey", session_key));
            }
            let result = client
                .post_json::<Value, _>("/api/abort", &query, &json!({}))
                .map(|_| DesktopEvent::PromptSent);
            Self::send_result(tx, result);
        });
    }

    pub fn run_slash_command(
        &self,
        name: String,
        args: String,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let query = Self::session_query(session_id.as_deref(), session_key.as_deref());
            let result = client
                .post_json::<Value, _>(
                    "/api/slash-command",
                    &query,
                    &json!({ "name": name, "args": args }),
                )
                .map(|_| DesktopEvent::PromptSent);
            Self::send_result(tx, result);
        });
    }

    pub fn set_hide_thinking(
        &self,
        hidden: bool,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let query = Self::session_query(session_id.as_deref(), session_key.as_deref());
            let result = client
                .post_json::<Value, _>(
                    "/api/settings/hide-thinking",
                    &query,
                    &json!({ "hidden": hidden }),
                )
                .map(|_| DesktopEvent::PromptSent);
            Self::send_result(tx, result);
        });
    }

    pub fn load_files(&self, cwd: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .get_json::<ProjectFileTreeResponse>("/api/files/tree", &[("cwd", &cwd)])
                .map(|response| DesktopEvent::Files(response.paths));
            Self::send_result(tx, result);
        });
    }

    pub fn load_file(&self, cwd: String, path: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .get_json::<ProjectFileReadResponse>(
                    "/api/files/read",
                    &[("cwd", &cwd), ("path", &path)],
                )
                .map(DesktopEvent::FileRead);
            Self::send_result(tx, result);
        });
    }

    pub fn load_git(&self, cwd: String, tx: Sender<DesktopEvent>) {
        let status_client = self.clone();
        let status_tx = tx.clone();
        let status_cwd = cwd.clone();
        std::thread::spawn(move || {
            let result = status_client
                .get_json::<GitStatusResponse>("/api/git-status", &[("cwd", &status_cwd)])
                .map(|response| DesktopEvent::GitStatus(response.git_status));
            Self::send_result(status_tx, result);
        });

        let changes_client = self.clone();
        std::thread::spawn(move || {
            let result = changes_client
                .get_json::<GitChangesResponse>(
                    "/api/git-changes",
                    &[("cwd", &cwd), ("gitScope", "all")],
                )
                .map(DesktopEvent::GitChanges);
            Self::send_result(tx, result);
        });
    }

    pub fn load_git_diff(&self, cwd: String, path: String, tx: Sender<DesktopEvent>) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .get_json::<GitFileDiffResponse>("/api/git-diff", &[("cwd", &cwd), ("path", &path)])
                .map(DesktopEvent::GitDiff);
            Self::send_result(tx, result);
        });
    }

    pub fn stage_git_file(
        &self,
        cwd: String,
        path: String,
        previous_path: Option<String>,
        unstage: bool,
        tx: Sender<DesktopEvent>,
    ) {
        self.git_mutation(
            "/api/git-stage",
            json!({
                "action": if unstage { "unstage" } else { "stage" },
                "cwd": cwd,
                "path": path,
                "previousPath": previous_path,
            }),
            if unstage {
                "Unstaged file"
            } else {
                "Staged file"
            },
            tx,
        );
    }

    pub fn stage_git_all(&self, cwd: String, unstage: bool, tx: Sender<DesktopEvent>) {
        self.git_mutation(
            "/api/git-stage",
            json!({
                "action": if unstage { "unstage-all" } else { "stage-all" },
                "all": true,
                "cwd": cwd,
            }),
            if unstage {
                "Unstaged all changes"
            } else {
                "Staged all changes"
            },
            tx,
        );
    }

    pub fn discard_git_file(
        &self,
        cwd: String,
        path: String,
        previous_path: Option<String>,
        status: String,
        tx: Sender<DesktopEvent>,
    ) {
        self.git_mutation(
            "/api/git-discard",
            json!({
                "cwd": cwd,
                "path": path,
                "previousPath": previous_path,
                "status": status,
            }),
            "Discarded file changes",
            tx,
        );
    }

    pub fn commit_git(&self, cwd: String, message: String, push: bool, tx: Sender<DesktopEvent>) {
        self.git_mutation(
            "/api/git-commit",
            json!({
                "cwd": cwd,
                "message": message,
                "push": push,
                "forcePush": false,
                "includeUnstaged": true,
            }),
            if push {
                "Committed and pushed changes"
            } else {
                "Committed changes"
            },
            tx,
        );
    }

    pub fn push_git(&self, cwd: String, force: bool, tx: Sender<DesktopEvent>) {
        self.git_mutation(
            "/api/git-push",
            json!({ "cwd": cwd, "force": force }),
            if force {
                "Force pushed"
            } else {
                "Pushed changes"
            },
            tx,
        );
    }

    pub fn pull_git(&self, cwd: String, tx: Sender<DesktopEvent>) {
        self.git_mutation("/api/git-pull", json!({ "cwd": cwd }), "Pulled changes", tx);
    }

    pub fn checkout_branch(&self, cwd: String, branch: String, tx: Sender<DesktopEvent>) {
        self.git_mutation(
            "/api/git-checkout",
            json!({ "cwd": cwd, "branch": branch }),
            "Checked out branch",
            tx,
        );
    }

    fn git_mutation(
        &self,
        path: &'static str,
        body: Value,
        success_message: &'static str,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let result = client
                .post_json::<GitActionResponse, _>(path, &[], &body)
                .map(|response| {
                    let detail = if !response.stdout.trim().is_empty() {
                        format!("{success_message}: {}", response.stdout.trim())
                    } else if !response.stderr.trim().is_empty() {
                        format!("{success_message}: {}", response.stderr.trim())
                    } else {
                        success_message.to_string()
                    };
                    DesktopEvent::GitMutation(detail)
                });
            Self::send_result(tx, result);
        });
    }

    pub fn set_model(
        &self,
        model: crate::models::ModelOption,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = Vec::new();
            if let Some(session_id) = session_id.as_deref() {
                query.push(("session", session_id));
            }
            if let Some(session_key) = session_key.as_deref() {
                query.push(("sessionKey", session_key));
            }
            let result = client
                .post_json::<Value, _>(
                    "/api/model",
                    &query,
                    &json!({
                        "provider": model.provider.as_deref().unwrap_or_default(),
                        "modelId": model.id.clone(),
                    }),
                )
                .map(|_| DesktopEvent::ModelChanged(model));
            Self::send_result(tx, result);
        });
    }

    pub fn set_thinking(
        &self,
        level: String,
        session_id: Option<String>,
        session_key: Option<String>,
        tx: Sender<DesktopEvent>,
    ) {
        let client = self.clone();
        std::thread::spawn(move || {
            let mut query = Vec::new();
            if let Some(session_id) = session_id.as_deref() {
                query.push(("session", session_id));
            }
            if let Some(session_key) = session_key.as_deref() {
                query.push(("sessionKey", session_key));
            }
            let result = client
                .post_json::<Value, _>("/api/thinking", &query, &json!({ "level": level }))
                .map(|_| DesktopEvent::ThinkingChanged(level));
            Self::send_result(tx, result);
        });
    }

    fn send_result(tx: Sender<DesktopEvent>, result: Result<DesktopEvent>) {
        let event = result.unwrap_or_else(|error| DesktopEvent::Error(error.to_string()));
        let _ = tx.send_blocking(event);
    }

    fn get_json<T: DeserializeOwned>(&self, path: &str, query: &[(&str, &str)]) -> Result<T> {
        let url = self.request_url(path, query)?;
        let response = self.http.get(url).send()?.error_for_status()?;
        Self::decode(response)
    }

    fn post_json<T: DeserializeOwned, B: serde::Serialize + ?Sized>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        body: &B,
    ) -> Result<T> {
        let url = self.request_url(path, query)?;
        let response = self.http.post(url).json(body).send()?.error_for_status()?;
        Self::decode(response)
    }

    fn decode<T: DeserializeOwned>(response: Response) -> Result<T> {
        let value: Value = response.json()?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            return Err(anyhow!(
                "{}",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Pico request failed")
            ));
        }
        serde_json::from_value(value).map_err(Into::into)
    }

    fn request_url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url> {
        let mut url = self.endpoint(path)?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("context", &self.context_id);
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        Ok(url)
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        self.base_url
            .join(path.trim_start_matches('/'))
            .map_err(Into::into)
    }
}
