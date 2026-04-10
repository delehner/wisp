mod pr;

use std::path::Path;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tracing::{info, warn};

use crate::utils::{exec_capture, repo_name_from_url};

pub use pr::{create_pull_request, post_pr_evidence};

const WISP_STASH_MESSAGE: &str = "wisp: pre-rebase workspace";

/// Stash uncommitted changes so `git rebase` can run (e.g. assembled context overwriting a tracked `CLAUDE.md`).
/// Includes **untracked** files (`-u`) so a later `git checkout` is not blocked by untracked paths that
/// would be overwritten by tracked files on another branch.
/// Returns `true` if a stash entry was created.
pub async fn stash_workspace_if_dirty(workdir: &Path) -> Result<bool> {
    let (_, porcelain, _) = exec_capture("git", &["status", "--porcelain"], Some(workdir)).await?;
    if porcelain.trim().is_empty() {
        return Ok(false);
    }
    info!("stashing local changes before rebase");
    const STASH_ATTEMPTS: u32 = 3;
    let mut last_stderr = String::new();
    for attempt in 1..=STASH_ATTEMPTS {
        let (code, _, stderr) = exec_capture(
            "git",
            &["stash", "push", "-u", "-m", WISP_STASH_MESSAGE],
            Some(workdir),
        )
        .await?;
        if code == 0 {
            return Ok(true);
        }
        last_stderr = stderr;
        let transient = last_stderr.contains("could not write index")
            || last_stderr.contains("index.lock")
            || last_stderr.contains("Unable to create");
        let corrupted_index = last_stderr.contains("invalid object")
            || last_stderr.contains("Cannot save the current index state");
        if corrupted_index {
            warn!("detected corrupted git index before stash retry — rebuilding index");
            rebuild_git_index_from_head(workdir).await?;
        }
        if transient && has_unmerged_entries(workdir).await? {
            warn!("detected unmerged index entries before stash retry — repairing workdir");
            repair_conflicted_workdir(workdir).await?;
        }
        if transient && attempt == STASH_ATTEMPTS - 1 {
            clear_stale_index_lock(workdir);
        }
        if !(transient || corrupted_index) || attempt == STASH_ATTEMPTS {
            bail!("git stash failed: {last_stderr}");
        }
        warn!(
            attempt,
            max = STASH_ATTEMPTS,
            stderr = %last_stderr.trim(),
            "git stash failed (transient) — retrying"
        );
        tokio::time::sleep(Duration::from_millis(150 * u64::from(attempt))).await;
    }
    bail!("git stash failed: {last_stderr}");
}

async fn has_unmerged_entries(workdir: &Path) -> Result<bool> {
    let (_, stdout, _) = exec_capture("git", &["ls-files", "-u"], Some(workdir)).await?;
    Ok(!stdout.trim().is_empty())
}

async fn repair_conflicted_workdir(workdir: &Path) -> Result<()> {
    let _ = exec_capture("git", &["rebase", "--abort"], Some(workdir)).await;
    let _ = exec_capture("git", &["merge", "--abort"], Some(workdir)).await;
    let (reset_code, _, reset_err) =
        exec_capture("git", &["reset", "--hard", "HEAD"], Some(workdir)).await?;
    if reset_code != 0 {
        bail!("git reset --hard HEAD failed during workdir repair: {reset_err}");
    }
    let (clean_code, _, clean_err) = exec_capture("git", &["clean", "-fd"], Some(workdir)).await?;
    if clean_code != 0 {
        bail!("git clean -fd failed during workdir repair: {clean_err}");
    }
    Ok(())
}

async fn rebuild_git_index_from_head(workdir: &Path) -> Result<()> {
    // Drop a potentially corrupt index, then reconstruct from current HEAD.
    let index = workdir.join(".git/index");
    if index.exists() {
        std::fs::remove_file(&index)
            .with_context(|| format!("failed to remove corrupt index at {}", index.display()))?;
    }
    let (code, _, stderr) =
        exec_capture("git", &["reset", "--mixed", "HEAD"], Some(workdir)).await?;
    if code != 0 {
        bail!("git reset --mixed HEAD failed while rebuilding index: {stderr}");
    }
    Ok(())
}

fn clear_stale_index_lock(workdir: &Path) {
    let index_lock = workdir.join(".git/index.lock");
    if !index_lock.exists() {
        return;
    }
    match std::fs::remove_file(&index_lock) {
        Ok(()) => warn!(
            path = %index_lock.display(),
            "removed stale git index lock before stash retry"
        ),
        Err(err) => warn!(
            path = %index_lock.display(),
            error = %err,
            "failed to remove stale git index lock before stash retry"
        ),
    }
}

/// Restore `stash@{0}` after a matching [`stash_workspace_if_dirty`] that returned `true`.
/// Uses `git stash pop` so workspace changes are not discarded (e.g. when skipping a PR).
pub async fn pop_latest_stash(workdir: &Path) {
    match exec_capture("git", &["stash", "pop"], Some(workdir)).await {
        Ok((0, _, _)) => {}
        Ok((_, _, stderr)) => {
            warn!(
                stderr = %stderr.trim(),
                "git stash pop failed — stash entry may still exist; resolve conflicts manually"
            );
        }
        Err(e) => warn!(error = %e, "git stash pop failed"),
    }
}

/// Count commits reachable from `HEAD` but not from `origin/<remote_branch>`.
/// Requires `origin/<remote_branch>` to exist (e.g. after [`rebase_onto_latest`]'s fetch).
pub async fn commits_ahead_of_remote_branch(workdir: &Path, remote_branch: &str) -> Result<u32> {
    let range = format!("origin/{remote_branch}..HEAD");
    let (code, stdout, stderr) =
        exec_capture("git", &["rev-list", "--count", &range], Some(workdir)).await?;
    if code != 0 {
        bail!("git rev-list failed ({range}): {stderr}");
    }
    stdout
        .trim()
        .parse::<u32>()
        .with_context(|| format!("invalid rev-list output: {:?}", stdout.trim()))
}

/// Stage all tracked/untracked changes and create a commit.
/// Uses `--allow-empty` so pipeline runs always produce a commit on the feature branch.
pub async fn stage_all_and_commit(workdir: &Path, message: &str) -> Result<()> {
    let (add_code, _, add_err) = exec_capture("git", &["add", "-A"], Some(workdir)).await?;
    if add_code != 0 {
        bail!("git add -A failed: {add_err}");
    }
    let (commit_code, _, commit_err) = exec_capture(
        "git",
        &["commit", "--allow-empty", "-m", message],
        Some(workdir),
    )
    .await?;
    if commit_code != 0 {
        bail!("git commit failed: {commit_err}");
    }
    Ok(())
}

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
        if !repo_objects_healthy(&workdir).await? {
            warn!(repo = %repo_name, "detected corrupted git objects; recreating local clone");
            std::fs::remove_dir_all(&workdir).with_context(|| {
                format!("failed to remove corrupt workdir: {}", workdir.display())
            })?;
            clone_repo_into_workdir(repo_url, &workdir).await?;
        }
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

    clone_repo_into_workdir(repo_url, &workdir).await?;

    // Check if repo is empty (no commits)
    let (code, _, _) = exec_capture("git", &["log", "-1"], Some(&workdir)).await?;
    if code != 0 {
        info!(repo = %repo_name, "empty repo detected, seeding initial commit");
        seed_empty_repo(&workdir, base_branch, repo_url).await?;
        return Ok((workdir, true));
    }

    Ok((workdir, false))
}

async fn clone_repo_into_workdir(repo_url: &str, workdir: &Path) -> Result<()> {
    info!(repo = %repo_name_from_url(repo_url), "cloning");
    let workdir_str = workdir
        .to_str()
        .with_context(|| format!("non-utf8 workdir path: {}", workdir.display()))?;
    let (code, _, stderr) = exec_capture("git", &["clone", repo_url, workdir_str], None).await?;
    if code != 0 {
        bail!("git clone failed: {stderr}");
    }
    Ok(())
}

async fn repo_objects_healthy(workdir: &Path) -> Result<bool> {
    let (code, _, stderr) =
        exec_capture("git", &["fsck", "--full", "--no-dangling"], Some(workdir)).await?;
    if code == 0 {
        return Ok(true);
    }
    warn!(stderr = %stderr.trim(), "git fsck failed for workdir");
    Ok(false)
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

/// Create or checkout a feature branch from an explicit start point.
pub async fn create_feature_branch(
    workdir: &Path,
    branch_name: &str,
    start_point: Option<&str>,
) -> Result<()> {
    let (code, _, _) = exec_capture(
        "git",
        &["rev-parse", "--verify", branch_name],
        Some(workdir),
    )
    .await?;

    if code == 0 {
        info!(branch = %branch_name, "checking out existing branch");
        let (c2, _, stderr) =
            exec_capture("git", &["checkout", branch_name], Some(workdir)).await?;
        if c2 != 0 {
            bail!(
                "git checkout {branch_name} failed: {stderr}\n\
                 Uncommitted changes or merge conflicts (e.g. after a failed `git stash pop`) block checkout."
            );
        }
    } else {
        info!(branch = %branch_name, start = ?start_point, "creating new branch");
        if let Some(start) = start_point {
            let (c2, _, stderr) = exec_capture(
                "git",
                &["checkout", "-b", branch_name, start],
                Some(workdir),
            )
            .await?;
            if c2 != 0 {
                bail!("git checkout -b {branch_name} {start} failed: {stderr}");
            }
        } else {
            let (c2, _, stderr) =
                exec_capture("git", &["checkout", "-b", branch_name], Some(workdir)).await?;
            if c2 != 0 {
                bail!("git checkout -b {branch_name} failed: {stderr}");
            }
        }
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

/// Whether `origin` currently has a head named `branch` (uses `ls-remote`, not local remote-tracking refs).
pub async fn origin_branch_exists_on_remote(workdir: &Path, branch: &str) -> Result<bool> {
    let (code, stdout, stderr) = exec_capture(
        "git",
        &["ls-remote", "--heads", "origin", branch],
        Some(workdir),
    )
    .await?;
    if code != 0 {
        bail!("git ls-remote origin {branch} failed: {stderr}");
    }
    Ok(!stdout.trim().is_empty())
}

/// Fetch a branch from `origin` (no-op if already up to date).
pub async fn fetch_origin_branch(workdir: &Path, branch: &str) -> Result<()> {
    let (code, _, stderr) =
        exec_capture("git", &["fetch", "origin", branch], Some(workdir)).await?;
    if code != 0 {
        bail!("git fetch origin {branch} failed: {stderr}");
    }
    Ok(())
}

/// Push `HEAD` to `origin` with upstream. If the remote rejected the push as non-fast-forward,
/// fetch `head_branch`, rebase onto `origin/<head_branch>`, and push once more.
pub async fn push_head_to_origin_with_rebase_retry(
    workdir: &Path,
    head_branch: &str,
) -> Result<()> {
    info!("pushing branch to origin");
    let (code, _, stderr) =
        exec_capture("git", &["push", "-u", "origin", "HEAD"], Some(workdir)).await?;
    if code == 0 {
        return Ok(());
    }
    let err_lc = stderr.to_lowercase();
    let looks_behind = err_lc.contains("non-fast-forward")
        || err_lc.contains("rejected")
        || err_lc.contains("failed to push");
    if !looks_behind {
        bail!("git push failed: {stderr}");
    }

    info!(
        head_branch = %head_branch,
        "push rejected; rebasing onto origin/{head_branch} and retrying"
    );
    fetch_origin_branch(workdir, head_branch).await?;
    let (ok, _, vrf_err) = exec_capture(
        "git",
        &["rev-parse", "--verify", &format!("origin/{head_branch}")],
        Some(workdir),
    )
    .await?;
    if ok != 0 {
        bail!(
            "git push failed (non-fast-forward) and origin/{head_branch} is not available after fetch: {vrf_err}"
        );
    }
    let (r_code, _, r_err) = exec_capture(
        "git",
        &["rebase", &format!("origin/{head_branch}")],
        Some(workdir),
    )
    .await?;
    if r_code != 0 {
        let _ = exec_capture("git", &["rebase", "--abort"], Some(workdir)).await;
        bail!(
            "rebase onto origin/{head_branch} failed after non-fast-forward push: {r_err}",
            head_branch = head_branch
        );
    }
    let (p2, _, e2) = exec_capture("git", &["push", "-u", "origin", "HEAD"], Some(workdir)).await?;
    if p2 != 0 {
        bail!("git push failed after rebase: {e2}");
    }
    Ok(())
}

/// Rebase the current branch onto the latest target branch.
pub async fn rebase_onto_latest(workdir: &Path, target_branch: &str) -> Result<bool> {
    fetch_origin_branch(workdir, target_branch).await?;
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

/// Patterns appended to `.git/info/exclude` so pipeline artifacts stay out of `git status`.
const GIT_EXCLUDE_SNIPPETS: &[&str] = &[
    ".agent-progress/",
    ".pipeline/",
    "logs/",
    ".devenv/.devcontainer/",
];

/// Write git exclude patterns for pipeline artifacts.
pub fn write_git_excludes(workdir: &Path) -> Result<()> {
    let exclude_file = workdir.join(".git/info/exclude");
    let mut content = std::fs::read_to_string(&exclude_file).unwrap_or_default();
    let mut appended = false;
    for snippet in GIT_EXCLUDE_SNIPPETS {
        if !content.contains(snippet) {
            content.push_str(snippet);
            content.push('\n');
            appended = true;
        }
    }
    if appended {
        if let Some(parent) = exclude_file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&exclude_file, content)?;
    }
    Ok(())
}
