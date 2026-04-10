use std::io::Read as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use crate::cli::InstallAgentsArgs;

const TARBALL_URL: &str = "https://github.com/delehner/wisp/archive/refs/heads/main.tar.gz";
const AGENTS_PREFIX: &str = "wisp-main/agents/";
/// Files under this prefix install to `.devenv/.devcontainer/agent/` under the wisp data root.
const DEVCONTAINER_AGENT_PREFIX: &str = "wisp-main/.devcontainer/agent/";
/// Files under this prefix install to `.ai/skills/` under the wisp data root.
const SKILLS_PREFIX: &str = "wisp-main/skills/";
/// Hard cap on tarball download size to prevent OOM from unexpectedly large responses.
const MAX_TARBALL_BYTES: usize = 50 * 1024 * 1024; // 50 MB

pub async fn run(args: &InstallAgentsArgs) -> Result<()> {
    let dest = resolve_destination(args.output.as_deref())?;
    let wisp_root = install_data_root(&dest);
    let dc_dir = wisp_root.join(".devenv/.devcontainer/agent");
    let skills_dir = wisp_root.join(".ai/skills");

    if !args.force {
        if let Some(backup) = backup_if_exists(&dest)? {
            println!("Backed up existing agents to {}", backup.display());
        }
        if let Some(backup) = backup_if_exists(&dc_dir)? {
            println!("Backed up existing devcontainer to {}", backup.display());
        }
        if let Some(backup) = backup_if_exists(&skills_dir)? {
            println!("Backed up existing skills to {}", backup.display());
        }
    }

    tokio::fs::create_dir_all(&dest)
        .await
        .with_context(|| format!("failed to create destination directory: {}", dest.display()))?;

    tracing::info!(dest = %dest.display(), "downloading agent files");

    let bytes = fetch_tarball().await?;

    let force = args.force;
    let dest_clone = dest.clone();
    let dc_clone = dc_dir.clone();
    let skills_clone = skills_dir.clone();
    let count = tokio::task::spawn_blocking(move || {
        extract_assets(&bytes, &dest_clone, &dc_clone, &skills_clone, force)
    })
    .await
    .context("extraction task panicked")??;

    println!(
        "Installed {} files under {} (.ai/agents, .ai/skills, .devenv/.devcontainer/agent)",
        count,
        wisp_root.display()
    );
    Ok(())
}

fn resolve_destination(output: Option<&Path>) -> Result<PathBuf> {
    if let Some(p) = output {
        return Ok(p.to_path_buf());
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    Ok(PathBuf::from(home).join(".wisp/.ai/agents"))
}

/// Walk from `dest` up to the wisp data root.
/// When `dest` ends with `.ai/agents` (default install), walks up two levels.
/// When `dest` ends with just `agents`, walks up one level (legacy / custom paths).
/// Otherwise `dest` is treated as the data root.
fn install_data_root(dest: &Path) -> PathBuf {
    let components: Vec<_> = dest.components().collect();
    let len = components.len();
    if len >= 2 {
        let parent_name = components[len - 2].as_os_str().to_str();
        let last_name = components[len - 1].as_os_str().to_str();
        if parent_name == Some(".ai") && last_name == Some("agents") {
            return dest
                .ancestors()
                .nth(2)
                .map(Path::to_path_buf)
                .unwrap_or_else(|| dest.to_path_buf());
        }
    }
    match dest.file_name().and_then(|n| n.to_str()) {
        Some("agents") => dest
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| dest.to_path_buf()),
        _ => dest.to_path_buf(),
    }
}

/// Rename an existing directory to `<name>.v<N>` where N is the next available version.
/// Returns the backup path if a rename was performed, or `None` if the directory didn't exist.
fn backup_if_exists(dir: &Path) -> Result<Option<PathBuf>> {
    if !dir.is_dir() {
        return Ok(None);
    }
    let parent = dir.parent().context("cannot backup root directory")?;
    let name = dir
        .file_name()
        .context("cannot determine directory name")?
        .to_string_lossy();

    let mut version = 1u32;
    loop {
        let backup_name = format!("{}.v{}", name, version);
        let backup_path = parent.join(&backup_name);
        if !backup_path.exists() {
            std::fs::rename(dir, &backup_path).with_context(|| {
                format!(
                    "failed to backup {} to {}",
                    dir.display(),
                    backup_path.display()
                )
            })?;
            return Ok(Some(backup_path));
        }
        version += 1;
    }
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

fn extract_assets(
    bytes: &[u8],
    agents_dest: &Path,
    devcontainer_dest: &Path,
    skills_dest: &Path,
    force: bool,
) -> Result<usize> {
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
        let (target_dir, prefix_to_strip): (&Path, &str) = if raw_str.starts_with(AGENTS_PREFIX) {
            (agents_dest, AGENTS_PREFIX)
        } else if raw_str.starts_with(DEVCONTAINER_AGENT_PREFIX) {
            (devcontainer_dest, DEVCONTAINER_AGENT_PREFIX)
        } else if raw_str.starts_with(SKILLS_PREFIX) {
            (skills_dest, SKILLS_PREFIX)
        } else {
            continue;
        };

        if !entry.header().entry_type().is_file() {
            continue;
        }

        let rel = raw_path
            .strip_prefix(prefix_to_strip)
            .context("unexpected tar path structure")?
            .to_path_buf();

        if !is_safe_path(&rel) {
            tracing::warn!(path = %rel.display(), "skipping unsafe tar entry");
            continue;
        }

        let dest_path = target_dir.join(&rel);
        let existed = dest_path.exists();

        if existed && !force {
            println!("  (skip) {}", rel.display());
            continue;
        }

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create dir: {}", parent.display()))?;
        }

        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .with_context(|| format!("failed to read entry: {}", rel.display()))?;

        std::fs::write(&dest_path, &contents)
            .with_context(|| format!("failed to write: {}", dest_path.display()))?;

        if existed && force {
            println!("  → {} [overwrite]", rel.display());
        } else {
            println!("  → {}", rel.display());
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
        assert_eq!(result, PathBuf::from(home).join(".wisp/.ai/agents"));
    }

    #[test]
    fn test_resolve_destination_relative_output() {
        let path = PathBuf::from("./agents");
        let result = resolve_destination(Some(&path)).unwrap();
        assert_eq!(result, path);
    }

    // --- is_safe_path ---

    #[test]
    fn test_is_safe_path_normal() {
        assert!(is_safe_path(Path::new("architect/prompt.md")));
    }

    #[test]
    fn test_is_safe_path_single_filename() {
        assert!(is_safe_path(Path::new("prompt.md")));
    }

    #[test]
    fn test_is_safe_path_cur_dir_prefix() {
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
        let stripped = Path::new(raw).strip_prefix(AGENTS_PREFIX).unwrap();
        assert_eq!(stripped, Path::new("architect/prompt.md"));
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

    // --- install_data_root ---

    #[test]
    fn test_install_data_root_default_ai_agents_dest() {
        let p = PathBuf::from("/home/user/.wisp/.ai/agents");
        assert_eq!(install_data_root(&p), PathBuf::from("/home/user/.wisp"));
    }

    #[test]
    fn test_install_data_root_legacy_agents_dest() {
        let p = PathBuf::from("/home/user/.wisp/agents");
        assert_eq!(install_data_root(&p), PathBuf::from("/home/user/.wisp"));
    }

    #[test]
    fn test_install_data_root_custom_flat() {
        let p = PathBuf::from("/tmp/out");
        assert_eq!(install_data_root(&p), PathBuf::from("/tmp/out"));
    }

    // --- DEVCONTAINER_AGENT_PREFIX ---

    #[test]
    fn test_devcontainer_prefix_strips_correctly() {
        let raw = "wisp-main/.devcontainer/agent/devcontainer.json";
        assert!(raw.starts_with(DEVCONTAINER_AGENT_PREFIX));
        let stripped = Path::new(raw)
            .strip_prefix(DEVCONTAINER_AGENT_PREFIX)
            .unwrap();
        assert_eq!(stripped, Path::new("devcontainer.json"));
    }

    #[test]
    fn test_skills_prefix_strips_correctly() {
        let raw = "wisp-main/skills/code-review/SKILL.md";
        assert!(raw.starts_with(SKILLS_PREFIX));
        let stripped = Path::new(raw).strip_prefix(SKILLS_PREFIX).unwrap();
        assert_eq!(stripped, Path::new("code-review/SKILL.md"));
    }

    // --- backup_if_exists ---

    #[test]
    fn test_backup_creates_v1() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("agents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("test.md"), b"old").unwrap();

        let backup = backup_if_exists(&dir).unwrap();
        assert!(backup.is_some());
        let backup_path = backup.unwrap();
        assert_eq!(backup_path, tmp.path().join("agents.v1"));
        assert!(backup_path.is_dir());
        assert!(!dir.exists());
        assert_eq!(
            std::fs::read_to_string(backup_path.join("test.md")).unwrap(),
            "old"
        );
    }

    #[test]
    fn test_backup_increments_version() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("agents");
        std::fs::create_dir_all(tmp.path().join("agents.v1")).unwrap();
        std::fs::create_dir_all(&dir).unwrap();

        let backup = backup_if_exists(&dir).unwrap();
        assert!(backup.is_some());
        assert_eq!(backup.unwrap(), tmp.path().join("agents.v2"));
    }

    #[test]
    fn test_backup_noop_when_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("agents");
        let backup = backup_if_exists(&dir).unwrap();
        assert!(backup.is_none());
    }

    // --- extract_assets (in-memory tarball) ---

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

    fn test_dests(tmp: &tempfile::TempDir) -> (PathBuf, PathBuf, PathBuf) {
        (
            tmp.path().join(".ai/agents"),
            tmp.path().join(".devenv/.devcontainer/agent"),
            tmp.path().join(".ai/skills"),
        )
    }

    #[test]
    fn test_extract_assets_creates_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);
        let content = b"# Architect prompt";
        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", content)]);

        let count = extract_assets(&bytes, &agents, &dc, &skills, false).unwrap();
        assert_eq!(count, 1);
        let written = agents.join("architect/prompt.md");
        assert!(written.exists(), "file should exist after extraction");
        assert_eq!(std::fs::read(&written).unwrap(), content);
    }

    #[test]
    fn test_extract_assets_skips_existing_without_force() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);
        let dir = agents.join("architect");
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("prompt.md");
        std::fs::write(&existing, b"old content").unwrap();

        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", b"new content")]);
        let count = extract_assets(&bytes, &agents, &dc, &skills, false).unwrap();

        assert_eq!(count, 0);
        assert_eq!(std::fs::read(&existing).unwrap(), b"old content");
    }

    #[test]
    fn test_extract_assets_overwrites_with_force() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);
        let dir = agents.join("architect");
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("prompt.md");
        std::fs::write(&existing, b"old content").unwrap();

        let bytes = make_tarball(&[("wisp-main/agents/architect/prompt.md", b"new content")]);
        let count = extract_assets(&bytes, &agents, &dc, &skills, true).unwrap();

        assert_eq!(count, 1);
        assert_eq!(std::fs::read(&existing).unwrap(), b"new content");
    }

    #[test]
    fn test_extract_assets_skips_non_asset_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);
        let bytes = make_tarball(&[
            ("wisp-main/agents/developer/prompt.md", b"dev prompt"),
            ("wisp-main/src/main.rs", b"fn main() {}"),
            ("wisp-main/Cargo.toml", b"[package]"),
        ]);

        let count = extract_assets(&bytes, &agents, &dc, &skills, false).unwrap();
        assert_eq!(count, 1);
        assert!(agents.join("developer/prompt.md").exists());
        assert!(!tmp.path().join("src/main.rs").exists());
    }

    #[test]
    fn test_extract_assets_multiple_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);
        let bytes = make_tarball(&[
            ("wisp-main/agents/architect/prompt.md", b"architect"),
            ("wisp-main/agents/developer/prompt.md", b"developer"),
            ("wisp-main/agents/_base-system.md", b"base"),
        ]);

        let count = extract_assets(&bytes, &agents, &dc, &skills, false).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn test_extract_assets_includes_devcontainer_and_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (agents, dc, skills) = test_dests(&tmp);

        let bytes = make_tarball(&[
            ("wisp-main/agents/architect/prompt.md", b"arch"),
            (
                "wisp-main/.devcontainer/agent/devcontainer.json",
                b"{\"name\":\"test\"}",
            ),
            (
                "wisp-main/.devcontainer/agent/Dockerfile",
                b"FROM scratch\n",
            ),
            ("wisp-main/skills/code-review/SKILL.md", b"# Code Review"),
            ("wisp-main/skills/testing-strategy/SKILL.md", b"# Testing"),
        ]);

        let count = extract_assets(&bytes, &agents, &dc, &skills, false).unwrap();
        assert_eq!(count, 5);

        assert!(agents.join("architect/prompt.md").is_file());
        let dc_file = dc.join("devcontainer.json");
        assert!(dc_file.is_file());
        assert_eq!(
            std::fs::read_to_string(dc_file).unwrap(),
            "{\"name\":\"test\"}"
        );
        assert!(dc.join("Dockerfile").is_file());
        assert!(skills.join("code-review/SKILL.md").is_file());
        assert_eq!(
            std::fs::read_to_string(skills.join("code-review/SKILL.md")).unwrap(),
            "# Code Review"
        );
        assert!(skills.join("testing-strategy/SKILL.md").is_file());
    }

    /// Network integration test — skipped in CI; run manually with `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn test_fetch_tarball_live() {
        let bytes = fetch_tarball().await.unwrap();
        assert!(!bytes.is_empty(), "tarball should not be empty");
        assert_eq!(&bytes[..2], &[0x1f, 0x8b], "should be a gzip stream");
    }
}
