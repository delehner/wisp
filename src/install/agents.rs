use std::io::Read as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use crate::cli::InstallAgentsArgs;

const TARBALL_URL: &str = "https://github.com/delehner/wisp/archive/refs/heads/main.tar.gz";
const AGENTS_PREFIX: &str = "wisp-main/agents/";

pub async fn run(args: &InstallAgentsArgs) -> Result<()> {
    let dest = resolve_destination(args.output.as_deref())?;
    tokio::fs::create_dir_all(&dest)
        .await
        .with_context(|| format!("failed to create destination directory: {}", dest.display()))?;

    tracing::info!(dest = %dest.display(), "downloading agent files");

    let bytes = fetch_tarball().await?;

    let force = args.force;
    let dest_clone = dest.clone();
    let count = tokio::task::spawn_blocking(move || extract_agents(&bytes, &dest_clone, force))
        .await
        .context("extraction task panicked")??;

    println!("Agents installed to {} ({} files)", dest.display(), count);
    Ok(())
}

fn resolve_destination(output: Option<&Path>) -> Result<PathBuf> {
    if let Some(p) = output {
        return Ok(p.to_path_buf());
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    Ok(PathBuf::from(home).join(".wisp/agents"))
}

async fn fetch_tarball() -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .user_agent("wisp")
        .build()
        .context("failed to build HTTP client")?;

    let mut req = client.get(TARBALL_URL);
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        req = req.header("Authorization", format!("Bearer {token}"));
    }

    let resp = req.send().await.context("failed to send request")?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("HTTP {status} downloading agent tarball from {TARBALL_URL}");
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .context("failed to read response body")
}

fn is_safe_path(path: &Path) -> bool {
    use std::path::Component;
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return false,
        }
    }
    true
}

fn extract_agents(bytes: &[u8], dest: &Path, force: bool) -> Result<usize> {
    let gz = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(gz);

    let mut count = 0usize;

    for entry in archive.entries().context("failed to read tar entries")? {
        let mut entry = entry.context("failed to read tar entry")?;
        let raw_path = entry
            .path()
            .context("failed to get entry path")?
            .into_owned();

        let raw_str = raw_path.to_string_lossy();
        if !raw_str.starts_with(AGENTS_PREFIX) {
            continue;
        }

        // Skip directories
        if entry.header().entry_type().is_dir() {
            continue;
        }

        // Strip "wisp-main/" prefix
        let stripped = raw_path
            .strip_prefix("wisp-main/")
            .context("unexpected tar path structure")?
            .to_path_buf();

        // Path traversal guard
        if !is_safe_path(&stripped) {
            tracing::warn!(path = %stripped.display(), "skipping unsafe tar entry");
            continue;
        }

        let dest_path = dest.join(&stripped);
        let existed = dest_path.exists();

        if existed && !force {
            println!("  (skip) {}", stripped.display());
            continue;
        }

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create dir: {}", parent.display()))?;
        }

        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .with_context(|| format!("failed to read entry: {}", stripped.display()))?;

        std::fs::write(&dest_path, &contents)
            .with_context(|| format!("failed to write: {}", dest_path.display()))?;

        if existed && force {
            println!("  → {} [overwrite]", stripped.display());
        } else {
            println!("  → {}", stripped.display());
        }
        count += 1;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_destination_with_output() {
        let path = PathBuf::from("/custom/path");
        let result = resolve_destination(Some(&path)).unwrap();
        assert_eq!(result, path);
    }

    #[test]
    fn test_resolve_destination_default() {
        let result = resolve_destination(None).unwrap();
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        assert_eq!(result, PathBuf::from(home).join(".wisp/agents"));
    }

    #[test]
    fn test_agents_prefix_strips_correctly() {
        let raw = "wisp-main/agents/architect/prompt.md";
        assert!(raw.starts_with(AGENTS_PREFIX));
        let stripped = raw.strip_prefix("wisp-main/").unwrap();
        assert_eq!(stripped, "agents/architect/prompt.md");
    }

    #[test]
    fn test_is_safe_path_normal() {
        assert!(is_safe_path(Path::new("agents/architect/prompt.md")));
    }

    #[test]
    fn test_is_safe_path_traversal() {
        assert!(!is_safe_path(Path::new("../etc/passwd")));
        assert!(!is_safe_path(Path::new("/absolute/path")));
    }
}
