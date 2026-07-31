use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Serializable server-owned facts. Process handles and async channels live in
/// `RuntimeRegistry`, keeping state transitions testable without child processes.
#[derive(Debug, Default)]
pub struct AppState {
    next_session_id: u64,
    sessions: BTreeMap<String, SessionRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub cwd: PathBuf,
    pub session_path: Option<PathBuf>,
}

impl AppState {
    pub fn from_sessions(sessions: Vec<SessionRecord>) -> Self {
        let mut state = Self::default();
        for session in sessions {
            if let Some(number) = session
                .id
                .strip_prefix("rust-")
                .and_then(|number| number.parse::<u64>().ok())
            {
                state.next_session_id = state.next_session_id.max(number);
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
        };
        let mut state = AppState::from_sessions(vec![restored]);
        assert_eq!(
            state.reserve_session(PathBuf::from("/tmp/new"), None).id,
            "rust-8"
        );
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
