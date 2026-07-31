use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    pub listen_hosts: Vec<IpAddr>,
    pub port: u16,
    pub pi_binary: PathBuf,
    pub pi_bridge_binary: Option<PathBuf>,
    pub web_dir: Option<PathBuf>,
    pub agent_dir: PathBuf,
    pub paths: ServerPaths,
    pub allowed_origins: Vec<String>,
    pub max_request_bytes: usize,
}

#[derive(Debug, Default)]
pub struct ServerOptions {
    pub pi_bridge_binary: Option<PathBuf>,
    pub web_dir: Option<PathBuf>,
    pub data_dir: Option<PathBuf>,
    pub agent_dir: Option<PathBuf>,
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerPaths {
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub control_socket: PathBuf,
    pub state_file: PathBuf,
    pub network_config_file: PathBuf,
}

impl ServerConfig {
    pub fn new(
        host: IpAddr,
        port: u16,
        pi_binary: PathBuf,
        options: ServerOptions,
    ) -> io::Result<Self> {
        let paths = ServerPaths::new(options.data_dir.unwrap_or(default_data_dir()?));
        let network_config = crate::network_config::load(&paths.network_config_file)?;
        Ok(Self {
            listen_hosts: listen_hosts(host, network_config.active_remote_address()),
            port,
            pi_binary: crate::pi_installation::resolve_pi_binary(pi_binary),
            pi_bridge_binary: resolve_pi_bridge_binary(options.pi_bridge_binary),
            web_dir: resolve_web_dir(options.web_dir),
            agent_dir: options.agent_dir.unwrap_or(default_agent_dir()?),
            paths,
            allowed_origins: options.allowed_origins,
            max_request_bytes: 64 * 1024 * 1024,
        })
    }

    pub fn loopback(port: u16, pi_binary: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            listen_hosts: vec![IpAddr::V4(Ipv4Addr::LOCALHOST)],
            port,
            pi_binary: crate::pi_installation::resolve_pi_binary(pi_binary),
            pi_bridge_binary: None,
            web_dir: None,
            agent_dir: PathBuf::from(".pi/agent"),
            paths: ServerPaths::new(data_dir),
            allowed_origins: Vec::new(),
            max_request_bytes: 64 * 1024 * 1024,
        }
    }
}

fn resolve_web_dir(explicit: Option<PathBuf>) -> Option<PathBuf> {
    if explicit.is_some() {
        return explicit;
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            let adjacent = parent.join("web");
            if adjacent.join("_shell.html").is_file() {
                return Some(adjacent);
            }
        }
    }
    let development = PathBuf::from(".output/public");
    development
        .join("_shell.html")
        .is_file()
        .then_some(development)
}

fn resolve_pi_bridge_binary(explicit: Option<PathBuf>) -> Option<PathBuf> {
    if explicit.is_some() {
        return explicit;
    }
    let executable = std::env::current_exe().ok()?;
    let adjacent = executable.parent()?.join("pico-pi-bridge");
    adjacent.is_file().then_some(adjacent)
}

impl ServerPaths {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            log_dir: data_dir.join("logs"),
            control_socket: data_dir.join("pico.sock"),
            state_file: data_dir.join("server-state.json"),
            network_config_file: data_dir.join("server-config.json"),
            data_dir,
        }
    }

    pub fn create(&self) -> io::Result<()> {
        create_private_directory(&self.data_dir)?;
        create_private_directory(&self.log_dir)
    }
}

pub fn default_agent_dir() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("PI_CODING_AGENT_DIR").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?;
    Ok(home.join(".pi/agent"))
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

fn listen_hosts(primary: IpAddr, remote: Option<IpAddr>) -> Vec<IpAddr> {
    if primary.is_unspecified() {
        return vec![primary];
    }

    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let mut hosts = vec![loopback];
    for host in [Some(primary), remote].into_iter().flatten() {
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    hosts
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
        assert_eq!(
            paths.network_config_file,
            paths.data_dir.join("server-config.json")
        );
        assert_eq!(paths.log_dir, paths.data_dir.join("logs"));
    }

    #[test]
    fn loopback_is_the_only_implicit_bind_address() {
        let config =
            ServerConfig::loopback(3141, PathBuf::from("pi"), PathBuf::from("/tmp/pico-test"));
        assert_eq!(config.listen_hosts, vec![IpAddr::V4(Ipv4Addr::LOCALHOST)]);
        assert!(config.allowed_origins.is_empty());
    }

    #[test]
    fn remote_listener_keeps_loopback_available() {
        let hosts = listen_hosts(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            Some("100.64.0.10".parse().expect("address")),
        );
        assert_eq!(
            hosts,
            vec![
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                "100.64.0.10".parse().expect("address"),
            ]
        );
    }

    #[test]
    fn wildcard_listener_is_not_combined_with_specific_addresses() {
        let hosts = listen_hosts(
            "0.0.0.0".parse().expect("wildcard"),
            Some("100.64.0.10".parse().expect("address")),
        );
        assert_eq!(hosts, vec!["0.0.0.0".parse::<IpAddr>().expect("wildcard")]);
    }
}
