use std::path::Path;

use anyhow::Result;
use tokio::io::AsyncBufReadExt;
use tracing::info;

/// Tail log files in a directory, optionally filtered by agent name.
pub async fn tail_logs(
    log_dir: &Path,
    agent_filter: Option<&str>,
    raw: bool,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<()> {
    use notify::{Event, EventKind, RecursiveMode, Watcher};
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    let log_dir = log_dir.to_path_buf();
    if !log_dir.is_dir() {
        std::fs::create_dir_all(&log_dir)?;
    }

    let tailed: Arc<Mutex<HashSet<std::path::PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));

    let pattern_suffix = if raw { ".jsonl" } else { ".log" };
    let agent_prefix = agent_filter.map(|a| format!("{a}_"));

    // Start tailing existing files
    {
        let mut seen = tailed.lock().await;
        if let Ok(entries) = std::fs::read_dir(&log_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if should_tail(&path, pattern_suffix, agent_prefix.as_deref()) {
                    seen.insert(path.clone());
                    spawn_tail(path, cancel.clone());
                }
            }
        }
    }

    // Watch for new files
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Create(_)) {
                for path in event.paths {
                    let _ = tx.blocking_send(path);
                }
            }
        }
    })?;
    watcher.watch(&log_dir, RecursiveMode::NonRecursive)?;

    info!(dir = %log_dir.display(), "monitoring logs");

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            Some(path) = rx.recv() => {
                if should_tail(&path, pattern_suffix, agent_prefix.as_deref()) {
                    let mut seen = tailed.lock().await;
                    if seen.insert(path.clone()) {
                        spawn_tail(path, cancel.clone());
                    }
                }
            }
        }
    }

    Ok(())
}

fn should_tail(path: &Path, suffix: &str, agent_prefix: Option<&str>) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };

    if !name.ends_with(suffix) {
        return false;
    }

    if let Some(prefix) = agent_prefix {
        if !name.starts_with(prefix) {
            return false;
        }
    }

    true
}

fn spawn_tail(path: std::path::PathBuf, cancel: tokio_util::sync::CancellationToken) {
    tokio::spawn(async move {
        let file = match tokio::fs::File::open(&path).await {
            Ok(f) => f,
            Err(_) => return,
        };
        let reader = tokio::io::BufReader::new(file);
        let mut lines = reader.lines();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                result = lines.next_line() => {
                    match result {
                        Ok(Some(line)) => {
                            let prefix = path.file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("?");
                            println!("\x1b[2m[{prefix}]\x1b[0m {line}");
                        }
                        Ok(None) => {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });
}

/// List resumable sessions from log files.
pub async fn list_sessions(log_dir: &Path) -> Result<()> {
    if !log_dir.is_dir() {
        println!("No log directory found: {}", log_dir.display());
        return Ok(());
    }

    let mut sessions: Vec<(String, String)> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("session") {
                let session_id = std::fs::read_to_string(&path)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .to_string();
                if !session_id.is_empty() {
                    sessions.push((name, session_id));
                }
            }
        }
    }

    if sessions.is_empty() {
        println!("No resumable sessions found.");
    } else {
        println!("Resumable sessions:");
        for (name, id) in &sessions {
            println!("  {name}: {id}");
        }
    }

    Ok(())
}
