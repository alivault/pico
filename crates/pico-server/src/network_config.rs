use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const NETWORK_CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NetworkConfig {
    pub version: u32,
    pub remote_access_enabled: bool,
    pub remote_bind_address: Option<IpAddr>,
}

impl NetworkConfig {
    pub fn with_remote_address(address: IpAddr) -> io::Result<Self> {
        validate_remote_bind_address(address)?;
        Ok(Self {
            version: NETWORK_CONFIG_VERSION,
            remote_access_enabled: true,
            remote_bind_address: Some(address),
        })
    }

    pub fn disabled(address: Option<IpAddr>) -> Self {
        Self {
            version: NETWORK_CONFIG_VERSION,
            remote_access_enabled: false,
            remote_bind_address: address,
        }
    }

    pub fn active_remote_address(&self) -> Option<IpAddr> {
        self.remote_access_enabled
            .then_some(self.remote_bind_address)
            .flatten()
    }
}

pub fn load(path: &Path) -> io::Result<NetworkConfig> {
    let content = match std::fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(NetworkConfig::default());
        }
        Err(error) => return Err(error),
    };
    let config: NetworkConfig = serde_json::from_slice(&content)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if config.version > NETWORK_CONFIG_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "network configuration version {} is newer than supported {}",
                config.version, NETWORK_CONFIG_VERSION
            ),
        ));
    }
    if config.remote_access_enabled {
        let address = config.remote_bind_address.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "remote access is enabled without a bind address",
            )
        })?;
        validate_remote_bind_address(address)?;
    }
    Ok(config)
}

pub fn store(path: &Path, config: &NetworkConfig) -> io::Result<()> {
    if config.remote_access_enabled {
        let address = config.remote_bind_address.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "remote access requires a bind address",
            )
        })?;
        validate_remote_bind_address(address)?;
    }

    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "network configuration path has no parent",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    restrict_directory(parent)?;
    let temporary = temporary_path(path);
    let content = serde_json::to_vec_pretty(config)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    std::fs::write(&temporary, content)?;
    restrict_file(&temporary)?;
    std::fs::rename(&temporary, path)
}

pub fn validate_remote_bind_address(address: IpAddr) -> io::Result<()> {
    let invalid = address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || matches!(address, IpAddr::V4(value) if value == Ipv4Addr::BROADCAST);
    if invalid {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "remote bind address must be a specific non-loopback unicast IP address",
        ));
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("server-config.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
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
            "pico-network-config-test-{}-{}",
            std::process::id(),
            NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn missing_configuration_defaults_to_local_only() {
        let config = load(&test_dir().join("server-config.json")).expect("load default");
        assert!(!config.remote_access_enabled);
        assert_eq!(config.active_remote_address(), None);
    }

    #[test]
    fn remote_configuration_round_trips() {
        let directory = test_dir();
        let path = directory.join("server-config.json");
        let address = "100.64.0.10".parse().expect("address");
        let config = NetworkConfig::with_remote_address(address).expect("config");
        store(&path, &config).expect("store");
        assert_eq!(load(&path).expect("load"), config);
        std::fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn unsafe_remote_bind_addresses_are_rejected() {
        for address in ["0.0.0.0", "127.0.0.1", "224.0.0.1", "255.255.255.255"] {
            let address = address.parse().expect("address");
            assert!(validate_remote_bind_address(address).is_err(), "{address}");
        }
    }

    #[test]
    fn enabled_configuration_requires_an_address() {
        let directory = test_dir();
        let path = directory.join("server-config.json");
        let config = NetworkConfig {
            version: NETWORK_CONFIG_VERSION,
            remote_access_enabled: true,
            remote_bind_address: None,
        };
        assert_eq!(
            store(&path, &config).expect_err("missing address").kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
