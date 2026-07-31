use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::broadcast;

const MAX_REPLAY_EVENTS: usize = 512;

#[derive(Debug, Clone)]
pub struct ServerEvent {
    pub sequence: u64,
    pub context_id: Option<String>,
    pub session_id: Option<String>,
    pub payload: Value,
}

#[derive(Clone)]
pub struct EventHub {
    inner: Arc<Mutex<EventState>>,
    live: broadcast::Sender<ServerEvent>,
}

#[derive(Default)]
struct EventState {
    next_sequence: u64,
    events: VecDeque<ServerEvent>,
}

impl Default for EventHub {
    fn default() -> Self {
        let (live, _) = broadcast::channel(MAX_REPLAY_EVENTS);
        Self {
            inner: Arc::new(Mutex::new(EventState::default())),
            live,
        }
    }
}

impl EventHub {
    pub fn push(
        &self,
        context_id: Option<String>,
        session_id: Option<String>,
        payload: Value,
    ) -> ServerEvent {
        let event = {
            let mut state = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.next_sequence = state.next_sequence.saturating_add(1);
            let event = ServerEvent {
                sequence: state.next_sequence,
                context_id,
                session_id,
                payload,
            };
            state.events.push_back(event.clone());
            while state.events.len() > MAX_REPLAY_EVENTS {
                state.events.pop_front();
            }
            event
        };
        let _ = self.live.send(event.clone());
        event
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerEvent> {
        self.live.subscribe()
    }

    /// Returns `None` when the requested cursor predates the retained window.
    pub fn events_after(&self, sequence: u64) -> Option<Vec<ServerEvent>> {
        let state = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let first = state.events.front().map(|event| event.sequence);
        if first.is_some_and(|first| sequence.saturating_add(1) < first) {
            return None;
        }
        Some(
            state
                .events
                .iter()
                .filter(|event| event.sequence > sequence)
                .cloned()
                .collect(),
        )
    }

    pub fn current_sequence(&self) -> u64 {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .next_sequence
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_sequenced_and_replayed() {
        let hub = EventHub::default();
        hub.push(None, None, serde_json::json!({"type":"one"}));
        hub.push(None, None, serde_json::json!({"type":"two"}));
        let replay = hub.events_after(1).expect("replay");
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].sequence, 2);
        assert_eq!(replay[0].payload["type"], "two");
    }

    #[test]
    fn old_cursors_report_a_gap() {
        let hub = EventHub::default();
        for index in 0..=MAX_REPLAY_EVENTS {
            hub.push(None, None, serde_json::json!({"index": index}));
        }
        assert!(hub.events_after(0).is_none());
        assert_eq!(hub.current_sequence(), MAX_REPLAY_EVENTS as u64 + 1);
    }
}
