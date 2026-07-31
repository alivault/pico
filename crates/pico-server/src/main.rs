use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use pico_server::config::{default_data_dir, ServerConfig, ServerOptions, ServerPaths};
use pico_server::{api, control, logging, pi_rpc};

#[derive(Debug, Parser)]
#[command(name = "pico-server", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the native HTTP server.
    Serve {
        #[arg(long, env = "PICO_HOST", default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST))]
        host: IpAddr,
        #[arg(long, env = "PICO_PORT", default_value_t = 3141)]
        port: u16,
        #[arg(long, env = "PICO_PI_BIN", default_value = "pi")]
        pi_bin: PathBuf,
        #[arg(long, env = "PICO_PI_BRIDGE_BIN")]
        pi_bridge_bin: Option<PathBuf>,
        #[arg(long, env = "PICO_WEB_DIR")]
        web_dir: Option<PathBuf>,
        #[arg(long, env = "PICO_DATA_DIR")]
        data_dir: Option<PathBuf>,
        #[arg(long, env = "PI_CODING_AGENT_DIR")]
        agent_dir: Option<PathBuf>,
        #[arg(
            long = "allow-origin",
            env = "PICO_ALLOWED_ORIGINS",
            value_delimiter = ','
        )]
        allowed_origins: Vec<String>,
    },
    /// Print status from the owner-only local control socket.
    Status {
        #[arg(long, env = "PICO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// Ask the running server to drain and stop.
    Stop {
        #[arg(long, env = "PICO_DATA_DIR")]
        data_dir: Option<PathBuf>,
        /// Wait until all active Pi work finishes and the control socket closes.
        #[arg(long)]
        wait: bool,
        /// Maximum seconds to wait; zero waits indefinitely.
        #[arg(long, default_value_t = 0)]
        timeout: u64,
    },
    /// Start Pi in RPC mode and verify the language-neutral protocol.
    PiSmoke {
        #[arg(long, env = "PICO_PI_BIN", default_value = "pi")]
        pi_bin: PathBuf,
        #[arg(long, default_value = ".")]
        cwd: PathBuf,
        #[arg(long)]
        session: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let command = Cli::parse().command.unwrap_or(Command::Serve {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 3141,
        pi_bin: PathBuf::from("pi"),
        pi_bridge_bin: None,
        web_dir: None,
        data_dir: None,
        agent_dir: None,
        allowed_origins: Vec::new(),
    });

    match command {
        Command::Serve {
            host,
            port,
            pi_bin,
            pi_bridge_bin,
            web_dir,
            data_dir,
            agent_dir,
            allowed_origins,
        } => {
            let config = ServerConfig::new(
                host,
                port,
                pi_bin,
                ServerOptions {
                    pi_bridge_binary: pi_bridge_bin,
                    web_dir,
                    data_dir,
                    agent_dir,
                    allowed_origins,
                },
            )?;
            config.paths.create()?;
            let _log_guard = logging::init(Some(&config.paths.log_dir))?;
            api::serve(config).await?;
        }
        Command::Status { data_dir } => {
            let _log_guard = logging::init(None)?;
            print_control_response(data_dir, "status").await?;
        }
        Command::Stop {
            data_dir,
            wait,
            timeout,
        } => {
            let _log_guard = logging::init(None)?;
            let response = print_control_response(data_dir.clone(), "stop").await?;
            if wait {
                if let Some(status) = response.status {
                    if status.active_run_count > 0 {
                        eprintln!(
                            "Waiting for {} active Pi run(s) to finish before stopping...",
                            status.active_run_count
                        );
                    }
                }
                wait_for_shutdown(data_dir, timeout).await?;
            }
        }
        Command::PiSmoke {
            pi_bin,
            cwd,
            session,
        } => {
            let _log_guard = logging::init(None)?;
            let client = pi_rpc::PiRpcClient::spawn(
                pi_rpc::PiSpawnOptions::new(pi_bin, cwd).with_session(session),
            )
            .await?;
            let state = client
                .request(serde_json::json!({ "type": "get_state" }))
                .await?;
            println!("{}", serde_json::to_string_pretty(&state)?);
            client.shutdown().await?;
        }
    }

    Ok(())
}

async fn print_control_response(
    data_dir: Option<PathBuf>,
    method: &str,
) -> Result<control::ControlResponse, Box<dyn std::error::Error>> {
    let paths = ServerPaths::new(match data_dir {
        Some(path) => path,
        None => default_data_dir()?,
    });
    let response = control::request(&paths.control_socket, method).await?;
    println!("{}", serde_json::to_string_pretty(&response)?);
    if !response.ok {
        return Err(response
            .error
            .clone()
            .unwrap_or_else(|| "control request failed".into())
            .into());
    }
    Ok(response)
}

async fn wait_for_shutdown(
    data_dir: Option<PathBuf>,
    timeout_seconds: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let paths = ServerPaths::new(match data_dir {
        Some(path) => path,
        None => default_data_dir()?,
    });
    let started_at = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(200)).await;
        match control::request(&paths.control_socket, "status").await {
            Ok(response) if !response.ok => {
                return Err(response
                    .error
                    .unwrap_or_else(|| "control status request failed".into())
                    .into());
            }
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                ) =>
            {
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        }
        if timeout_seconds > 0
            && started_at.elapsed() >= Duration::from_secs(timeout_seconds)
        {
            return Err(format!(
                "timed out waiting {timeout_seconds} seconds for active Pico work to drain"
            )
            .into());
        }
    }
}
