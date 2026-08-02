use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::pi_rpc::{PiRpcClient, PiRpcError, PiSpawnOptions};

/// Non-serializable process ownership. This is intentionally separate from
/// `AppState`, following Herdr's state/runtime boundary.
#[derive(Default)]
pub struct RuntimeRegistry {
    pi_binary: PathBuf,
    state: RwLock<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    sessions: HashMap<String, RuntimeEntry>,
    session_owners: HashMap<PathBuf, String>,
}

struct RuntimeEntry {
    client: Arc<PiRpcClient>,
    session_identity: Option<PathBuf>,
}

pub struct RuntimeSpawn {
    pub owner_id: String,
    pub client: Arc<PiRpcClient>,
    pub spawned: bool,
}

impl RuntimeRegistry {
    pub fn new(pi_binary: PathBuf) -> Self {
        Self {
            pi_binary,
            state: RwLock::new(RuntimeState::default()),
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
    ) -> Result<RuntimeSpawn, PiRpcError> {
        let session_identity = session.as_deref().map(normalized_session_path);
        let mut state = self.state.write().await;
        if let Some(entry) = state.sessions.get(&id) {
            return Ok(RuntimeSpawn {
                owner_id: id,
                client: entry.client.clone(),
                spawned: false,
            });
        }
        if let Some(identity) = session_identity.as_ref() {
            if let Some(owner_id) = state.session_owners.get(identity).cloned() {
                if let Some(entry) = state.sessions.get(&owner_id) {
                    return Ok(RuntimeSpawn {
                        owner_id,
                        client: entry.client.clone(),
                        spawned: false,
                    });
                }
                state.session_owners.remove(identity);
            }
        }

        // Keep the registry write lock while spawning so concurrent requests for
        // the same session cannot create two standalone Pi processes.
        let client = PiRpcClient::spawn(
            PiSpawnOptions::new(self.pi_binary.clone(), cwd).with_session(session),
        )
        .await?;
        if let Some(identity) = &session_identity {
            state.session_owners.insert(identity.clone(), id.clone());
        }
        state.sessions.insert(
            id.clone(),
            RuntimeEntry {
                client: client.clone(),
                session_identity,
            },
        );
        Ok(RuntimeSpawn {
            owner_id: id,
            client,
            spawned: true,
        })
    }

    pub async fn get(&self, id: &str) -> Option<Arc<PiRpcClient>> {
        self.state
            .read()
            .await
            .sessions
            .get(id)
            .map(|entry| entry.client.clone())
    }

    pub async fn get_by_session(&self, path: &Path) -> Option<(String, Arc<PiRpcClient>)> {
        let identity = normalized_session_path(path);
        let state = self.state.read().await;
        let owner_id = state.session_owners.get(&identity)?.clone();
        let client = state.sessions.get(&owner_id)?.client.clone();
        Some((owner_id, client))
    }

    /// Updates the path identity after Pi creates, forks, clones, or moves a
    /// session. Returns the existing owner when another process already owns it.
    pub async fn set_session_path(&self, id: &str, path: &Path) -> Option<String> {
        let identity = normalized_session_path(path);
        let mut state = self.state.write().await;
        if let Some(owner_id) = state.session_owners.get(&identity) {
            if owner_id != id {
                return Some(owner_id.clone());
            }
        }
        let previous = state
            .sessions
            .get(id)
            .and_then(|entry| entry.session_identity.clone());
        if let Some(previous) = previous {
            state.session_owners.remove(&previous);
        }
        let entry = state.sessions.get_mut(id)?;
        entry.session_identity = Some(identity.clone());
        state.session_owners.insert(identity, id.to_string());
        None
    }

    pub async fn remove(&self, id: &str) -> Result<bool, PiRpcError> {
        let entry = {
            let mut state = self.state.write().await;
            let entry = state.sessions.remove(id);
            if let Some(identity) = entry
                .as_ref()
                .and_then(|entry| entry.session_identity.as_ref())
            {
                state.session_owners.remove(identity);
            }
            entry
        };
        if let Some(entry) = entry {
            entry.client.shutdown().await?;
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn shutdown(&self) {
        let clients = {
            let mut state = self.state.write().await;
            state.session_owners.clear();
            state
                .sessions
                .drain()
                .map(|(_, entry)| entry.client)
                .collect::<Vec<_>>()
        };
        for client in clients {
            if let Err(error) = client.shutdown().await {
                tracing::warn!(%error, "failed to stop Pi RPC process");
            }
        }
    }
}

fn normalized_session_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    #[tokio::test]
    async fn one_session_path_owns_only_one_pi_process() {
        let root = std::env::temp_dir().join(format!(
            "pico-runtime-dedup-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let session = root.join("session.jsonl");
        std::fs::write(&session, "{}\n").expect("write session");
        let executable = root.join("fake-pi.sh");
        std::fs::write(
            &executable,
            "#!/bin/sh\nwhile IFS= read -r line; do :; done\n",
        )
        .expect("write fake Pi");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
            .expect("make fake Pi executable");

        let registry = RuntimeRegistry::new(executable);
        let first = registry
            .spawn("runtime-one".into(), root.clone(), Some(session.clone()))
            .await
            .expect("spawn first runtime");
        let second = registry
            .spawn("runtime-two".into(), root.clone(), Some(session))
            .await
            .expect("reuse first runtime");

        assert!(first.spawned);
        assert!(!second.spawned);
        assert_eq!(second.owner_id, "runtime-one");
        assert!(Arc::ptr_eq(&first.client, &second.client));
        assert!(registry.get("runtime-two").await.is_none());

        registry.shutdown().await;
        std::fs::remove_dir_all(root).expect("remove fixture");
    }
}
