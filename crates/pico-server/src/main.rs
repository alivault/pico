use pico_server::{api, pi_rpc};

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "pico-server", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the experimental native HTTP server.
    Serve {
        #[arg(long, env = "PICO_HOST", default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST))]
        host: IpAddr,
        #[arg(long, env = "PICO_PORT", default_value_t = 3141)]
        port: u16,
        #[arg(long, env = "PICO_PI_BIN", default_value = "pi")]
        pi_bin: PathBuf,
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
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("pico_server=info")),
        )
        .init();

    match Cli::parse().command.unwrap_or(Command::Serve {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 3141,
        pi_bin: PathBuf::from("pi"),
    }) {
        Command::Serve { host, port, pi_bin } => {
            api::serve(SocketAddr::new(host, port), pi_bin).await?;
        }
        Command::PiSmoke {
            pi_bin,
            cwd,
            session,
        } => {
            let client = pi_rpc::PiRpcClient::spawn(pi_rpc::PiSpawnOptions {
                binary: pi_bin,
                cwd,
                session,
            })
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
