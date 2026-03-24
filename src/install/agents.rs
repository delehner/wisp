use std::io::Read as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use crate::cli::InstallAgentsArgs;

const TARBALL_URL: &str = "https://github.com/delehner/wisp/archive/refs/heads/main.tar.gz";
const AGENTS_PREFIX: &str = "wisp-main/agents/";
/// Hard cap on tarball download size to prevent OOM from unexpectedly large responses.
const MAX_TARBALL_BYTES: usize = 50 * 1024 * 1024; // 50 MB

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

    // Reject suspiciously large responses before allocating.
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_TARBALL_BYTES {
            anyhow::bail!(
                "tarball Content-Length ({} bytes) exceeds limit of {} bytes",
                len,
                MAX_TARBALL_BYTES
            );
        }
    }

    let bytes = resp.bytes().await.context("failed to read response body")?;

    if bytes.len() > MAX_TARBALL_BYTES {
        anyhow::bail!(
            "tarball response ({} bytes) exceeds limit of {} bytes",
            bytes.len(),
            MAX_TARBALL_BYTES
        );
    }

    Ok(bytes.to_vec())
}

fn is_safe_path(path: &Path) -> bool {
    use std::path::Component;
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
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

        // Skip anything that is not a regular file (directories, symlinks, hardlinks, etc.)
        if !entry.header().entry_type().is_file() {
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

    // --- resolve_destination ---

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
    fn test_resolve_destination_relative_output() {
        // Relative paths passed via --output are returned as-is
        let path = PathBuf::from("./agents");
        let result = resolve_destination(Some(&path)).unwrap();
        assert_eq!(result, path);
    }

    // --- is_safe_path ---

    #[test]
    fn test_is_safe_path_normal() {
        assert!(is_safe_path(Path::new("agents/architect/prompt.md")));
    }

    #[test]
    fn test_is_safe_path_single_filename() {
        assert!(is_safe_path(Path::new("prompt.md")));
    }

    #[test]
    fn test_is_safe_path_cur_dir_prefix() {
        // CurDir ("./") is rejected — tar entries from GitHub never contain it,
        // and allowing it is unnecessary permissiveness.
        assert!(!is_safe_path(Path::new("./agents/prompt.md")));
    }

    #[test]
    fn test_is_safe_path_traversal_parent() {
        assert!(!is_safe_path(Path::new("../etc/passwd")));
    }

    #[test]
    fn test_is_safe_path_traversal_absolute() {
        assert!(!is_safe_path(Path::new("/absolute/path")));
    }

    #[test]
    fn test_is_safe_path_traversal_nested() {
        assert!(!is_safe_path(Path::new("agents/../../../etc/passwd")));
    }

    // --- AGENTS_PREFIX stripping ---

    #[test]
    fn test_agents_prefix_strips_correctly() {
        let raw = "wisp-main/agents/architect/prompt.md";
        assert!(raw.starts_with(AGENTS_PREFIX));
        let stripped = raw.strip_prefix("wisp-main/").unwrap();
        assert_eq!(stripped, "agents/architect/prompt.md");
    }

    #[test]
    fn test_non_agents_prefix_excluded() {
        let paths = [
            "wisp-main/src/main.rs",
            "wisp-main/Cargo.toml",
            "wisp-main/",
        ];
        for p in &paths {
            assert!(
                !p.starts_with(AGENTS_PREFIX),
                "{p} should not match agents prefix"
            );
        }
    }

    // --- extract_agents (in-memory tarball) ---

    fn make_tarball(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        let mut buf = Vec::new();
        {
            let enc = GzEncoder::new(&mut buf, Compression::default());
            let mut ar = tar::Builder::new(enc);
            for (path, content) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(content.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                ar.append_data(&mut header, path, *content).unwrap();
            }
            ar.into_inner().unwrap().finish().unwrap();
        }
        buf
    }

    #[test]
    fn test_extract_agents_creates_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let content = b"# Architect prompt";
        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", content)]);

        let count = extract_agents(&bytes, tmp.path(), false).unwrap();
        assert_eq!(count, 1);
        let written = tmp.path().join("agents/architect/prompt.md");
        assert!(written.exists(), "file should exist after extraction");
        assert_eq!(std::fs::read(&written).unwrap(), content);
    }

    #[test]
    fn test_extract_agents_skips_existing_without_force() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dest = tmp.path().join("agents/architect");
        std::fs::create_dir_all(&dest).unwrap();
        let existing = dest.join("prompt.md");
        std::fs::write(&existing, b"old content").unwrap();

        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", b"new content")]);
        let count = extract_agents(&bytes, tmp.path(), false).unwrap();

        // File existed and force=false → skipped, count=0
        assert_eq!(count, 0);
        assert_eq!(std::fs::read(&existing).unwrap(), b"old content");
    }

    #[test]
    fn test_extract_agents_overwrites_with_force() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dest = tmp.path().join("agents/architect");
        std::fs::create_dir_all(&dest).unwrap();
        let existing = dest.join("prompt.md");
        std::fs::write(&existing, b"old content").unwrap();

        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", b"new content")]);
        let count = extract_agents(&bytes, tmp.path(), true).unwrap();

        assert_eq!(count, 1);
        assert_eq!(std::fs::read(&existing).unwrap(), b"new content");
    }

    #[test]
    fn test_extract_agents_skips_non_agent_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bytes = make_tarball(&[
            ("wisp-main/agents/developer/prompt.md", b"dev prompt"),
            ("wisp-main/src/main.rs", b"fn main() {}"),
            ("wisp-main/Cargo.toml", b"[package]"),
        ]);

        let count = extract_agents(&bytes, tmp.path(), false).unwrap();
        assert_eq!(count, 1);
        assert!(tmp.path().join("agents/developer/prompt.md").exists());
        assert!(!tmp.path().join("src/main.rs").exists());
    }

    #[test]
    fn test_extract_agents_multiple_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bytes = make_tarball(&[
            ("wisp-main/agents/architect/prompt.md", b"architect"),
            ("wisp-main/agents/developer/prompt.md", b"developer"),
            ("wisp-main/agents/_base-system.md", b"base"),
        ]);

        let count = extract_agents(&bytes, tmp.path(), false).unwrap();
        assert_eq!(count, 3);
    }

    /// Network integration test — skipped in CI; run manually with `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn test_fetch_tarball_live() {
        let bytes = fetch_tarball().await.unwrap();
        assert!(!bytes.is_empty(), "tarball should not be empty");
        // Verify it starts with gzip magic bytes
        assert_eq!(&bytes[..2], &[0x1f, 0x8b], "should be a gzip stream");
    }
}
