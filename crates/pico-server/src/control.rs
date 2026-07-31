use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{watch, RwLock};
use tokio::time::timeout;

use crate::protocol::SERVER_PROTOCOL_VERSION;

const MAX_CONTROL_RECORD_BYTES: u64 = 64 * 1024;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlRequest {
    pub id: String,
    pub method: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ControlStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStatus {
    pub version: String,
    pub protocol_version: u32,
    pub host: String,
    pub port: u16,
    pub phase: String,
    pub pid: u32,
}

#[cfg(unix)]
pub struct ControlServer {
    listener: tokio::net::UnixListener,
    path: PathBuf,
    identity: SocketIdentity,
}

#[cfg(unix)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct SocketIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
impl ControlServer {
    pub async fn bind(path: &Path) -> io::Result<Self> {
        use std::os::unix::fs::PermissionsExt;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if path.exists() {
            match timeout(
                Duration::from_millis(250),
                tokio::net::UnixStream::connect(path),
            )
            .await
            {
                Ok(Ok(_)) => {
                    return Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        format!("Pico server is already running at {}", path.display()),
                    ));
                }
                _ => std::fs::remove_file(path)?,
            }
        }

        let listener = tokio::net::UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        let identity = socket_identity(path)?;
        Ok(Self {
            listener,
            path: path.to_path_buf(),
            identity,
        })
    }

    pub async fn run(
        self,
        status: Arc<RwLock<ControlStatus>>,
        shutdown: watch::Sender<bool>,
        mut stop: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        break;
                    }
                }
                accepted = self.listener.accept() => {
                    match accepted {
                        Ok((stream, _)) => {
                            let status = status.clone();
                            let shutdown = shutdown.clone();
                            tokio::spawn(async move {
                                let _ = handle_connection(stream, status, shutdown).await;
                            });
                        }
                        Err(error) => tracing::warn!(%error, "control socket accept failed"),
                    }
                }
            }
        }
        if socket_identity(&self.path).ok() == Some(self.identity) {
            if let Err(error) = std::fs::remove_file(&self.path) {
                if error.kind() != io::ErrorKind::NotFound {
                    tracing::warn!(%error, path = %self.path.display(), "failed to remove control socket");
                }
            }
        }
    }
}

#[cfg(unix)]
async fn handle_connection(
    stream: tokio::net::UnixStream,
    status: Arc<RwLock<ControlStatus>>,
    shutdown: watch::Sender<bool>,
) -> io::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader).take(MAX_CONTROL_RECORD_BYTES + 1);
    let mut record = Vec::new();
    reader.read_until(b'\n', &mut record).await?;
    let response = if record.len() as u64 > MAX_CONTROL_RECORD_BYTES {
        ControlResponse {
            id: "unknown".into(),
            ok: false,
            error: Some("control request is too large".into()),
            status: None,
        }
    } else {
        match serde_json::from_slice::<ControlRequest>(trim_delimiter(&record)) {
            Ok(request) => match request.method.as_str() {
                "ping" | "status" => ControlResponse {
                    id: request.id,
                    ok: true,
                    error: None,
                    status: Some(status.read().await.clone()),
                },
                "stop" => {
                    let response = ControlResponse {
                        id: request.id,
                        ok: true,
                        error: None,
                        status: Some(status.read().await.clone()),
                    };
                    let _ = shutdown.send(true);
                    response
                }
                _ => ControlResponse {
                    id: request.id,
                    ok: false,
                    error: Some(format!("unknown control method: {}", request.method)),
                    status: None,
                },
            },
            Err(error) => ControlResponse {
                id: "unknown".into(),
                ok: false,
                error: Some(format!("invalid control request: {error}")),
                status: None,
            },
        }
    };
    let mut encoded = serde_json::to_vec(&response).map_err(io::Error::other)?;
    encoded.push(b'\n');
    writer.write_all(&encoded).await?;
    writer.shutdown().await
}

#[cfg(unix)]
pub async fn request(path: &Path, method: &str) -> io::Result<ControlResponse> {
    let stream = timeout(CONTROL_TIMEOUT, tokio::net::UnixStream::connect(path))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "control connection timed out"))??;
    let (reader, mut writer) = stream.into_split();
    let request = ControlRequest {
        id: format!("cli:{}", std::process::id()),
        method: method.to_string(),
    };
    let mut encoded = serde_json::to_vec(&request).map_err(io::Error::other)?;
    encoded.push(b'\n');
    writer.write_all(&encoded).await?;
    writer.shutdown().await?;

    let mut reader = BufReader::new(reader).take(MAX_CONTROL_RECORD_BYTES + 1);
    let mut record = Vec::new();
    timeout(CONTROL_TIMEOUT, reader.read_until(b'\n', &mut record))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "control response timed out"))??;
    if record.len() as u64 > MAX_CONTROL_RECORD_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "control response is too large",
        ));
    }
    serde_json::from_slice(trim_delimiter(&record)).map_err(io::Error::other)
}

#[cfg(not(unix))]
pub async fn request(_path: &Path, _method: &str) -> io::Result<ControlResponse> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "local control is not implemented on this platform",
    ))
}

#[cfg(unix)]
fn socket_identity(path: &Path) -> io::Result<SocketIdentity> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(path)?;
    Ok(SocketIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

fn trim_delimiter(mut record: &[u8]) -> &[u8] {
    if record.ends_with(b"\n") {
        record = &record[..record.len() - 1];
    }
    if record.ends_with(b"\r") {
        record = &record[..record.len() - 1];
    }
    record
}

pub fn initial_status(host: String, port: u16) -> ControlStatus {
    ControlStatus {
        version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: SERVER_PROTOCOL_VERSION,
        host,
        port,
        phase: "starting".into(),
        pid: std::process::id(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_protocol_round_trips() {
        let response = ControlResponse {
            id: "one".into(),
            ok: true,
            error: None,
            status: Some(initial_status("127.0.0.1".into(), 3141)),
        };
        let encoded = serde_json::to_vec(&response).expect("encode");
        let decoded: ControlResponse = serde_json::from_slice(&encoded).expect("decode");
        assert_eq!(decoded, response);
    }

    #[test]
    fn initial_status_exposes_protocol_and_pid() {
        let status = initial_status("127.0.0.1".into(), 3141);
        assert_eq!(status.protocol_version, SERVER_PROTOCOL_VERSION);
        assert_eq!(status.port, 3141);
        assert!(status.pid > 0);
    }
}
