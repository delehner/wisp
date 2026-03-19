mod pr;

use std::path::Path;

use anyhow::{bail, Context, Result};
use tracing::{info, warn};

use crate::utils::{exec_capture, repo_name_from_url};

pub use pr::{create_pull_request, post_pr_evidence};

/// Clone a repo or fetch latest if it already exists.
/// Handles empty (virgin) repos by seeding an initial commit.
/// Returns (workdir, was_empty).
pub async fn clone_or_prepare(
    repo_url: &str,
    work_dir: &Path,
    base_branch: &str,
) -> Result<(std::path::PathBuf, bool)> {
    let repo_name = repo_name_from_url(repo_url);
    let workdir = work_dir.join(&repo_name);

    if workdir.join(".git").is_dir() {
        info!(repo = %repo_name, "fetching latest");
        exec_capture("git", &["fetch", "--all", "--quiet"], Some(&workdir)).await?;
        let (code, _, _) = exec_capture(
            "git",
            &["rev-parse", "--verify", &format!("origin/{base_branch}")],
            Some(&workdir),
        )
        .await?;
        if code != 0 {
            warn!(repo = %repo_name, "remote branch {base_branch} not found, may be empty");
        }
        return Ok((workdir, false));
    }

    std::fs::create_dir_all(&workdir)
        .with_context(|| format!("failed to create workdir: {}", workdir.display()))?;

    info!(repo = %repo_name, "cloning");
    let (code, _, stderr) = exec_capture(
        "git",
        &["clone", repo_url, workdir.to_str().unwrap_or(".")],
        None,
    )
    .await?;

    if code != 0 {
        bail!("git clone failed: {stderr}");
    }

    // Check if repo is empty (no commits)
    let (code, _, _) = exec_capture("git", &["log", "-1"], Some(&workdir)).await?;
    if code != 0 {
        info!(repo = %repo_name, "empty repo detected, seeding initial commit");
        seed_empty_repo(&workdir, base_branch, repo_url).await?;
        return Ok((workdir, true));
    }

    Ok((workdir, false))
}

async fn seed_empty_repo(workdir: &Path, base_branch: &str, _repo_url: &str) -> Result<()> {
    exec_capture("git", &["checkout", "-b", base_branch], Some(workdir)).await?;
    exec_capture(
        "git",
        &["commit", "--allow-empty", "-m", "chore: initial commit"],
        Some(workdir),
    )
    .await?;
    exec_capture("git", &["push", "-u", "origin", base_branch], Some(workdir)).await?;
    Ok(())
}

/// Create or checkout a feature branch.
pub async fn create_feature_branch(workdir: &Path, branch_name: &str) -> Result<()> {
    let (code, _, _) = exec_capture(
        "git",
        &["rev-parse", "--verify", branch_name],
        Some(workdir),
    )
    .await?;

    if code == 0 {
        info!(branch = %branch_name, "checking out existing branch");
        exec_capture("git", &["checkout", branch_name], Some(workdir)).await?;
    } else {
        info!(branch = %branch_name, "creating new branch");
        exec_capture("git", &["checkout", "-b", branch_name], Some(workdir)).await?;
    }
    Ok(())
}

/// Generate a branch name from a PRD title: `agent/<slug>-<YYYYMMDD>`
pub fn generate_branch_name(prd_title: &str) -> String {
    let slug = crate::prd::slugify(prd_title);
    let date = chrono_lite_today();
    format!("agent/{slug}-{date}")
}

fn chrono_lite_today() -> String {
    // Avoid pulling in chrono: use system time
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    // Approximate: good enough for branch names
    let year = 1970 + (days / 365);
    let day_of_year = days % 365;
    let month = day_of_year / 30 + 1;
    let day = day_of_year % 30 + 1;
    format!("{year}{month:02}{day:02}")
}

/// Rebase the current branch onto the latest target branch.
pub async fn rebase_onto_latest(workdir: &Path, target_branch: &str) -> Result<bool> {
    exec_capture("git", &["fetch", "origin", target_branch], Some(workdir)).await?;
    let (code, _, stderr) = exec_capture(
        "git",
        &["rebase", &format!("origin/{target_branch}")],
        Some(workdir),
    )
    .await?;

    if code != 0 {
        warn!("rebase failed, aborting: {stderr}");
        exec_capture("git", &["rebase", "--abort"], Some(workdir)).await?;
        return Ok(false);
    }
    Ok(true)
}

/// Write git exclude patterns for pipeline artifacts.
pub fn write_git_excludes(workdir: &Path) -> Result<()> {
    let exclude_file = workdir.join(".git/info/exclude");
    let excludes = ".agent-progress/\n.pipeline/\nlogs/\n";

    if let Ok(existing) = std::fs::read_to_string(&exclude_file) {
        if existing.contains(".agent-progress/") {
            return Ok(());
        }
    }

    let mut content = std::fs::read_to_string(&exclude_file).unwrap_or_default();
    content.push_str(excludes);
    std::fs::write(&exclude_file, content)?;
    Ok(())
}
