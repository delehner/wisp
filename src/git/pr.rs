use std::path::Path;

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::utils::exec_capture;

/// Push and create a pull request via `gh`.
/// Returns the PR URL on success.
pub async fn create_pull_request(
    workdir: &Path,
    base_branch: &str,
    prd_slug: &str,
) -> Result<String> {
    // Push
    info!("pushing branch to origin");
    let (code, _, stderr) =
        exec_capture("git", &["push", "-u", "origin", "HEAD"], Some(workdir)).await?;
    if code != 0 {
        anyhow::bail!("git push failed: {stderr}");
    }

    // Read PR description if available
    let pr_desc_path = workdir
        .join("docs/architecture")
        .join(prd_slug)
        .join("pr-description.md");

    let body = if pr_desc_path.is_file() {
        std::fs::read_to_string(&pr_desc_path)
            .with_context(|| format!("failed to read PR description: {}", pr_desc_path.display()))?
    } else {
        format!("Automated PR for {prd_slug}")
    };

    // Get current branch name
    let (_, branch_stdout, _) =
        exec_capture("git", &["branch", "--show-current"], Some(workdir)).await?;
    let branch = branch_stdout.trim();

    // Create PR
    info!(base = %base_branch, head = %branch, "creating pull request");
    let (code, stdout, stderr) = exec_capture(
        "gh",
        &[
            "pr",
            "create",
            "--base",
            base_branch,
            "--title",
            &format!("[agent] {prd_slug}"),
            "--body",
            &body,
        ],
        Some(workdir),
    )
    .await?;

    if code != 0 {
        anyhow::bail!("gh pr create failed: {stderr}");
    }

    let pr_url = stdout.trim().to_string();
    info!(url = %pr_url, "pull request created");
    Ok(pr_url)
}

/// Post agent reports as PR comments.
pub async fn post_pr_evidence(
    workdir: &Path,
    pr_url: &str,
    prd_slug: &str,
    evidence_agents: &[String],
) -> Result<()> {
    let report_mapping: &[(&str, &str)] = &[
        ("tester", "test-report.md"),
        ("performance", "performance-report.md"),
        ("secops", "security-report.md"),
        ("dependency", "dependency-report.md"),
        ("infrastructure", "infrastructure.md"),
        ("devops", "devops.md"),
    ];

    let arch_dir = workdir.join("docs/architecture").join(prd_slug);

    for (agent, filename) in report_mapping {
        if !evidence_agents.iter().any(|a| a == agent) {
            continue;
        }

        let report_path = arch_dir.join(filename);
        if !report_path.is_file() {
            continue;
        }

        let content = match std::fs::read_to_string(&report_path) {
            Ok(c) => c,
            Err(e) => {
                warn!(agent = %agent, error = %e, "failed to read report");
                continue;
            }
        };

        if content.trim().is_empty() {
            continue;
        }

        let comment = format!("## {agent} Report\n\n{content}");
        info!(agent = %agent, "posting evidence comment");

        let (code, _, stderr) = exec_capture(
            "gh",
            &["pr", "comment", pr_url, "--body", &comment],
            Some(workdir),
        )
        .await?;

        if code != 0 {
            warn!(agent = %agent, "failed to post comment: {stderr}");
        }
    }

    Ok(())
}
