use std::io;
use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;

pub fn init(log_dir: Option<&Path>) -> io::Result<Option<WorkerGuard>> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("pico_server=info"));

    if let Some(log_dir) = log_dir {
        std::fs::create_dir_all(log_dir)?;
        let appender = tracing_appender::rolling::daily(log_dir, "pico-server.log");
        let (writer, guard) = tracing_appender::non_blocking(appender);
        tracing_subscriber::registry()
            .with(filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .with_writer(writer)
                    .with_ansi(false),
            )
            .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
            .try_init()
            .map_err(io::Error::other)?;
        return Ok(Some(guard));
    }

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .try_init()
        .map_err(io::Error::other)?;
    Ok(None)
}
