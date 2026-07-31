use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    pub host: IpAddr,
    pub port: u16,
    pub pi_binary: PathBuf,
    pub paths: ServerPaths,
    pub allowed_origins: Vec<String>,
    pub max_request_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerPaths {
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub control_socket: PathBuf,
    pub state_file: PathBuf,
}

impl ServerConfig {
    pub fn new(
        host: IpAddr,
        port: u16,
        pi_binary: PathBuf,
        data_dir: Option<PathBuf>,
        allowed_origins: Vec<String>,
    ) -> io::Result<Self> {
        let paths = ServerPaths::new(data_dir.unwrap_or(default_data_dir()?));
        Ok(Self {
            host,
            port,
            pi_binary: crate::pi_installation::resolve_pi_binary(pi_binary),
            paths,
            allowed_origins,
            max_request_bytes: 64 * 1024 * 1024,
        })
    }

    pub fn loopback(port: u16, pi_binary: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port,
            pi_binary: crate::pi_installation::resolve_pi_binary(pi_binary),
            paths: ServerPaths::new(data_dir),
            allowed_origins: Vec::new(),
            max_request_bytes: 64 * 1024 * 1024,
        }
    }
}

impl ServerPaths {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            log_dir: data_dir.join("logs"),
            control_socket: data_dir.join("pico.sock"),
            state_file: data_dir.join("server-state.json"),
            data_dir,
        }
    }

    pub fn create(&self) -> io::Result<()> {
        create_private_directory(&self.data_dir)?;
        create_private_directory(&self.log_dir)
    }
}

pub fn default_data_dir() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?;

    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library/Application Support/Pico"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME").filter(|path| !path.is_empty()) {
            return Ok(PathBuf::from(data_home).join("pico"));
        }
        Ok(home.join(".local/share/pico"))
    }
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    restrict_directory(path)
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_paths_share_one_data_root() {
        let paths = ServerPaths::new(PathBuf::from("/tmp/pico-test"));
        assert_eq!(paths.control_socket, paths.data_dir.join("pico.sock"));
        assert_eq!(paths.state_file, paths.data_dir.join("server-state.json"));
        assert_eq!(paths.log_dir, paths.data_dir.join("logs"));
    }

    #[test]
    fn loopback_is_the_only_implicit_bind_address() {
        let config =
            ServerConfig::loopback(3141, PathBuf::from("pi"), PathBuf::from("/tmp/pico-test"));
        assert!(config.host.is_loopback());
        assert!(config.allowed_origins.is_empty());
    }
}
