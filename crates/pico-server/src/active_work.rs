use std::collections::HashSet;

use tokio::sync::{Notify, RwLock};

#[derive(Default)]
struct ActiveWorkState {
    draining: bool,
    sessions: HashSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkAdmission {
    Existing,
    Started,
    Rejected,
}

#[derive(Default)]
pub struct ActiveWorkTracker {
    state: RwLock<ActiveWorkState>,
    idle: Notify,
}

impl ActiveWorkTracker {
    pub async fn try_mark_active(&self, id: impl Into<String>) -> WorkAdmission {
        let id = id.into();
        let mut state = self.state.write().await;
        if state.sessions.contains(&id) {
            return WorkAdmission::Existing;
        }
        if state.draining {
            return WorkAdmission::Rejected;
        }
        state.sessions.insert(id);
        WorkAdmission::Started
    }

    pub async fn mark_active(&self, id: impl Into<String>) {
        self.state.write().await.sessions.insert(id.into());
    }

    pub async fn mark_inactive(&self, id: &str) {
        let became_idle = {
            let mut state = self.state.write().await;
            state.sessions.remove(id);
            state.sessions.is_empty()
        };
        if became_idle {
            self.idle.notify_waiters();
        }
    }

    pub async fn begin_draining(&self) {
        let is_idle = {
            let mut state = self.state.write().await;
            state.draining = true;
            state.sessions.is_empty()
        };
        if is_idle {
            self.idle.notify_waiters();
        }
    }

    pub async fn count(&self) -> usize {
        self.state.read().await.sessions.len()
    }

    pub async fn wait_until_idle(&self) {
        loop {
            let notified = self.idle.notified();
            if self.state.read().await.sessions.is_empty() {
                return;
            }
            notified.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn waiters_resume_only_after_all_work_finishes() {
        let tracker = Arc::new(ActiveWorkTracker::default());
        assert_eq!(
            tracker.try_mark_active("one").await,
            WorkAdmission::Started
        );
        assert_eq!(
            tracker.try_mark_active("two").await,
            WorkAdmission::Started
        );

        let waiting = {
            let tracker = tracker.clone();
            tokio::spawn(async move { tracker.wait_until_idle().await })
        };
        tracker.mark_inactive("one").await;
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());

        tracker.mark_inactive("two").await;
        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("idle waiter timed out")
            .expect("idle waiter task failed");
    }

    #[tokio::test]
    async fn draining_rejects_new_work_but_allows_existing_session_chains() {
        let tracker = ActiveWorkTracker::default();
        assert_eq!(
            tracker.try_mark_active("one").await,
            WorkAdmission::Started
        );
        tracker.begin_draining().await;
        assert_eq!(
            tracker.try_mark_active("one").await,
            WorkAdmission::Existing
        );
        assert_eq!(
            tracker.try_mark_active("two").await,
            WorkAdmission::Rejected
        );
        tracker.mark_inactive("one").await;
        tracker.wait_until_idle().await;
    }

    #[tokio::test]
    async fn duplicate_activity_is_idempotent() {
        let tracker = ActiveWorkTracker::default();
        tracker.mark_active("one").await;
        tracker.mark_active("one").await;
        assert_eq!(tracker.count().await, 1);
        tracker.mark_inactive("one").await;
        assert_eq!(tracker.count().await, 0);
    }
}
