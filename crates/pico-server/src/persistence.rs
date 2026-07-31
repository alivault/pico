use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::protocol::PERSISTENCE_VERSION;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshot {
    #[serde(default)]
    pub version: u32,
    pub port: u16,
    pub started_at_ms: u64,
    pub clean_shutdown: bool,
}

impl ServerSnapshot {
    pub fn started(port: u16) -> Self {
        Self {
            version: PERSISTENCE_VERSION,
            port,
            started_at_ms: unix_time_ms(),
            clean_shutdown: false,
        }
    }
}

pub fn load(path: &Path) -> io::Result<Option<ServerSnapshot>> {
    let content = match std::fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let snapshot: ServerSnapshot = serde_json::from_slice(&content)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if snapshot.version > PERSISTENCE_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "server state version {} is newer than supported {}",
                snapshot.version, PERSISTENCE_VERSION
            ),
        ));
    }
    Ok(Some(snapshot))
}

pub fn store(path: &Path, snapshot: &ServerSnapshot) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "state path has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let temporary = temporary_path(path);
    let content = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    std::fs::write(&temporary, content)?;
    restrict_file(&temporary)?;
    std::fs::rename(&temporary, path)
}

pub fn mark_clean_shutdown(path: &Path) -> io::Result<()> {
    let Some(mut snapshot) = load(path)? else {
        return Ok(());
    };
    snapshot.clean_shutdown = true;
    store(path, &snapshot)
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("server-state.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(unix)]
fn restrict_file(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_file(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(1);

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pico-persistence-test-{}-{}-{}",
            std::process::id(),
            unix_time_ms(),
            NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn snapshots_round_trip_and_mark_clean() {
        let directory = test_dir();
        let path = directory.join("state.json");
        let snapshot = ServerSnapshot::started(3141);
        store(&path, &snapshot).expect("store");
        assert_eq!(load(&path).expect("load"), Some(snapshot));

        mark_clean_shutdown(&path).expect("mark clean");
        assert!(
            load(&path)
                .expect("load clean")
                .expect("snapshot")
                .clean_shutdown
        );
        std::fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn future_snapshots_are_rejected() {
        let directory = test_dir();
        std::fs::create_dir_all(&directory).expect("create test directory");
        let path = directory.join("state.json");
        std::fs::write(
            &path,
            format!(
                "{{\"version\":{},\"port\":3141,\"startedAtMs\":0,\"cleanShutdown\":false}}",
                PERSISTENCE_VERSION + 1
            ),
        )
        .expect("write future state");
        assert_eq!(
            load(&path).expect_err("future version").kind(),
            io::ErrorKind::InvalidData
        );
        std::fs::remove_dir_all(directory).expect("remove test directory");
    }
}
