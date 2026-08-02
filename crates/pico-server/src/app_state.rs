use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Serializable server-owned facts. Process handles and async channels live in
/// `RuntimeRegistry`, keeping state transitions testable without child processes.
#[derive(Debug, Default)]
pub struct AppState {
    next_session_id: u64,
    sessions: BTreeMap<String, SessionRecord>,
    contexts: BTreeMap<String, ViewerContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub cwd: PathBuf,
    pub session_path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pi_session_id: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ViewerContext {
    pub selected_session: Option<String>,
    pub active_draft: Option<DraftSelection>,
    pub sidebar_directories: Vec<PathBuf>,
    pub unread_session_ids: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftSelection {
    pub session_key: String,
    pub cwd: PathBuf,
    pub runtime_id: Option<String>,
}

impl AppState {
    pub fn from_sessions(sessions: Vec<SessionRecord>) -> Self {
        let mut state = Self::default();
        let mut path_owners = HashMap::<PathBuf, String>::new();
        let mut pi_id_owners = HashMap::<String, String>::new();
        for session in sessions {
            if let Some(number) = session
                .id
                .strip_prefix("rust-")
                .and_then(|number| number.parse::<u64>().ok())
            {
                state.next_session_id = state.next_session_id.max(number);
            }
            let path_identity = session.session_path.as_deref().map(normalized_session_path);
            let existing_id = path_identity
                .as_ref()
                .and_then(|path| path_owners.get(path))
                .or_else(|| {
                    session
                        .pi_session_id
                        .as_ref()
                        .and_then(|id| pi_id_owners.get(id))
                })
                .cloned();
            if let Some(existing_id) = existing_id {
                if let Some(existing) = state.sessions.get_mut(&existing_id) {
                    if existing.pi_session_id.is_none() {
                        existing.pi_session_id = session.pi_session_id.clone();
                    }
                    existing.draft &= session.draft;
                }
                tracing::warn!(
                    duplicate_runtime_id = %session.id,
                    owner_runtime_id = %existing_id,
                    "discarding duplicate persisted Pi session runtime"
                );
                continue;
            }
            if let Some(path) = path_identity {
                path_owners.insert(path, session.id.clone());
            }
            if let Some(pi_session_id) = &session.pi_session_id {
                pi_id_owners.insert(pi_session_id.clone(), session.id.clone());
            }
            state.sessions.insert(session.id.clone(), session);
        }
        state
    }

    pub fn reserve_session(
        &mut self,
        cwd: PathBuf,
        session_path: Option<PathBuf>,
    ) -> SessionRecord {
        self.next_session_id = self.next_session_id.saturating_add(1);
        SessionRecord {
            id: format!("rust-{}", self.next_session_id),
            cwd,
            session_path,
            pi_session_id: None,
            draft: false,
        }
    }

    pub fn insert_session(&mut self, session: SessionRecord) {
        self.sessions.insert(session.id.clone(), session);
    }

    pub fn update_session_path(&mut self, id: &str, path: PathBuf) {
        if let Some(session) = self.sessions.get_mut(id) {
            session.session_path = Some(path);
        }
    }

    pub fn remove_session(&mut self, id: &str) -> Option<SessionRecord> {
        self.sessions.remove(id)
    }

    pub fn sessions(&self) -> Vec<SessionRecord> {
        self.sessions.values().cloned().collect()
    }

    pub fn update_context(
        &mut self,
        id: String,
        selected_session: Option<String>,
        sidebar_directories: Vec<PathBuf>,
    ) -> ViewerContext {
        let context = self.contexts.entry(id).or_default();
        if let Some(selected_session) = selected_session {
            context.unread_session_ids.remove(&selected_session);
            context.selected_session = Some(selected_session);
            context.active_draft = None;
        }
        context.sidebar_directories = sidebar_directories;
        context.clone()
    }

    pub fn context(&self, id: &str) -> Option<&ViewerContext> {
        self.contexts.get(id)
    }

    pub fn select_session(&mut self, context_id: &str, session_id: String) {
        let context = self.contexts.entry(context_id.to_string()).or_default();
        context.unread_session_ids.remove(&session_id);
        context.selected_session = Some(session_id);
        context.active_draft = None;
    }

    pub fn select_draft(
        &mut self,
        context_id: &str,
        session_key: String,
        cwd: PathBuf,
        runtime_id: Option<String>,
    ) {
        let context = self.contexts.entry(context_id.to_string()).or_default();
        context.selected_session = None;
        context.active_draft = Some(DraftSelection {
            session_key,
            cwd,
            runtime_id,
        });
    }

    pub fn base_cwd(&self, context_id: &str) -> Option<PathBuf> {
        let context = self.contexts.get(context_id)?;
        if let Some(selected_session) = context.selected_session.as_deref() {
            if let Some(session) = self.sessions.values().find(|session| {
                session.id == selected_session
                    || session.pi_session_id.as_deref() == Some(selected_session)
                    || session
                        .session_path
                        .as_ref()
                        .is_some_and(|path| path.to_string_lossy().as_ref() == selected_session)
            }) {
                return Some(session.cwd.clone());
            }
        }
        context
            .active_draft
            .as_ref()
            .map(|draft| draft.cwd.clone())
            .or_else(|| context.sidebar_directories.first().cloned())
    }

    pub fn mark_session_done(&mut self, session_id: &str) {
        for context in self.contexts.values_mut() {
            if context.selected_session.as_deref() != Some(session_id) {
                context.unread_session_ids.insert(session_id.to_string());
            }
        }
    }

    pub fn set_session_read(&mut self, context_id: &str, session_id: &str, read: bool) {
        let context = self.contexts.entry(context_id.to_string()).or_default();
        if read {
            context.unread_session_ids.remove(session_id);
        } else {
            context.unread_session_ids.insert(session_id.to_string());
        }
    }

    pub fn session_is_unread(&self, context_id: &str, session_id: &str) -> bool {
        self.contexts
            .get(context_id)
            .is_some_and(|context| context.unread_session_ids.contains(session_id))
    }
}

fn normalized_session_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_and_not_reused_after_removal() {
        let mut state = AppState::default();
        let first = state.reserve_session(PathBuf::from("/tmp/one"), None);
        state.insert_session(first.clone());
        assert_eq!(state.remove_session(&first.id), Some(first));

        let second = state.reserve_session(PathBuf::from("/tmp/two"), None);
        assert_eq!(second.id, "rust-2");
    }

    #[test]
    fn restored_ids_advance_without_reuse() {
        let restored = SessionRecord {
            id: "rust-7".into(),
            cwd: PathBuf::from("/tmp/restored"),
            session_path: Some(PathBuf::from("/tmp/session.jsonl")),
            pi_session_id: Some("pi-restored".into()),
            draft: false,
        };
        let mut state = AppState::from_sessions(vec![restored]);
        assert_eq!(
            state.reserve_session(PathBuf::from("/tmp/new"), None).id,
            "rust-8"
        );
    }

    #[test]
    fn restored_sessions_are_deduplicated_by_path_and_pi_id() {
        let path = PathBuf::from("/tmp/shared-session.jsonl");
        let first = SessionRecord {
            id: "rust-2".into(),
            cwd: PathBuf::from("/tmp/project"),
            session_path: Some(path.clone()),
            pi_session_id: Some("pi-shared".into()),
            draft: true,
        };
        let duplicate_path = SessionRecord {
            id: "rust-3".into(),
            cwd: PathBuf::from("/tmp/project"),
            session_path: Some(path),
            pi_session_id: Some("pi-shared".into()),
            draft: false,
        };
        let duplicate_id = SessionRecord {
            id: "rust-4".into(),
            cwd: PathBuf::from("/tmp/other"),
            session_path: Some(PathBuf::from("/tmp/other-session.jsonl")),
            pi_session_id: Some("pi-shared".into()),
            draft: false,
        };
        let mut state = AppState::from_sessions(vec![first, duplicate_path, duplicate_id]);
        let sessions = state.sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "rust-2");
        assert!(!sessions[0].draft);
        assert_eq!(
            state.reserve_session(PathBuf::from("/tmp/new"), None).id,
            "rust-5"
        );
    }

    #[test]
    fn viewer_contexts_keep_selection_directories_and_unread_overlays_isolated() {
        let mut state = AppState::default();
        state.update_context(
            "one".into(),
            Some("active".into()),
            vec![PathBuf::from("/tmp/one")],
        );
        state.update_context(
            "two".into(),
            Some("other".into()),
            vec![PathBuf::from("/tmp/two")],
        );
        state.mark_session_done("active");

        assert!(!state.session_is_unread("one", "active"));
        assert!(state.session_is_unread("two", "active"));
        assert_eq!(
            state
                .context("one")
                .map(|context| &context.sidebar_directories),
            Some(&vec![PathBuf::from("/tmp/one")])
        );
        state.set_session_read("two", "active", true);
        assert!(!state.session_is_unread("two", "active"));

        state.select_draft("one", "draft:one".into(), PathBuf::from("/tmp/draft"), None);
        assert_eq!(state.base_cwd("one"), Some(PathBuf::from("/tmp/draft")));
    }

    #[test]
    fn runtime_handles_are_not_part_of_serializable_state() {
        let mut state = AppState::default();
        let session = state.reserve_session(
            PathBuf::from("/tmp/project"),
            Some(PathBuf::from("/tmp/session.jsonl")),
        );
        state.insert_session(session);

        let json = serde_json::to_value(state.sessions()).expect("serialize sessions");
        assert_eq!(json[0]["cwd"], "/tmp/project");
        assert!(json[0].get("process").is_none());
    }
}
