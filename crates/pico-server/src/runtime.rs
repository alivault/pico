use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::pi_rpc::{PiRpcClient, PiRpcError, PiSpawnOptions};

/// Non-serializable process ownership. This is intentionally separate from
/// `AppState`, following Herdr's state/runtime boundary.
#[derive(Default)]
pub struct RuntimeRegistry {
    pi_binary: PathBuf,
    sessions: RwLock<HashMap<String, Arc<PiRpcClient>>>,
}

impl RuntimeRegistry {
    pub fn new(pi_binary: PathBuf) -> Self {
        Self {
            pi_binary,
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub fn pi_binary(&self) -> &PathBuf {
        &self.pi_binary
    }

    pub async fn spawn(
        &self,
        id: String,
        cwd: PathBuf,
        session: Option<PathBuf>,
    ) -> Result<Arc<PiRpcClient>, PiRpcError> {
        let client = PiRpcClient::spawn(
            PiSpawnOptions::new(self.pi_binary.clone(), cwd).with_session(session),
        )
        .await?;
        self.sessions.write().await.insert(id, client.clone());
        Ok(client)
    }

    pub async fn get(&self, id: &str) -> Option<Arc<PiRpcClient>> {
        self.sessions.read().await.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Result<bool, PiRpcError> {
        let client = self.sessions.write().await.remove(id);
        if let Some(client) = client {
            client.shutdown().await?;
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn shutdown(&self) {
        let clients = {
            let mut sessions = self.sessions.write().await;
            sessions
                .drain()
                .map(|(_, client)| client)
                .collect::<Vec<_>>()
        };
        for client in clients {
            if let Err(error) = client.shutdown().await {
                tracing::warn!(%error, "failed to stop Pi RPC process");
            }
        }
    }
}
