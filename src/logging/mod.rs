pub mod formatter;
pub mod monitor;

use tracing_subscriber::EnvFilter;

/// Initialize the tracing subscriber with the given log level.
pub fn init(level: &str) {
    let filter = EnvFilter::try_new(level).unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_timer(tracing_subscriber::fmt::time::uptime())
        .init();
}
