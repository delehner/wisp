use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::config::Config;
use crate::context;
use crate::git;
use crate::pipeline::agent::{AgentOutcome, AgentRunParams, AgentRunner};
use crate::pipeline::devcontainer::DevContainer;
use crate::prd::Prd;
use crate::provider::Provider;
use crate::utils::repo_name_from_url;

/// Configuration for a single pipeline run (one PRD x one repo).
pub struct PipelineRunConfig {
    pub prd_path: PathBuf,
    pub repo_url: String,
    pub base_branch: String,
    pub context_path: Option<PathBuf>,
    pub agents: Vec<String>,
    /// Default Ralph cap when no per-agent override matches (from manifest + config).
    pub max_iterations: u32,
    /// Per-agent caps from the manifest (partial); env-based overrides in [`Config`] fill gaps.
    pub manifest_agent_max_iterations: crate::config::AgentIterationOverrides,
    pub skip_pr: bool,
    pub use_devcontainer: bool,
    /// One `devcontainer up` for the whole agent sequence (faster). Default off: fresh container per agent.
    pub reuse_devcontainer: bool,
    pub interactive: bool,
    pub stack_on: Option<String>,
    /// When true (orchestrator only), push the feature branch after a run with 0 commits so a later stacked unit can use `origin/<branch>` as PR base.
    pub push_branch_for_downstream_stack: bool,
    pub evidence_agents: Vec<String>,
    pub work_dir: PathBuf,
}

/// Run the full pipeline for a single PRD x repo pair.
pub async fn run(
    run_config: &PipelineRunConfig,
    config: &Config,
    provider: &dyn Provider,
) -> Result<()> {
    let prd = Prd::load(&run_config.prd_path)?;
    if prd.is_done() {
        info!(title = %prd.title, "PRD already done, skipping");
        return Ok(());
    }

    let repo_name = repo_name_from_url(&run_config.repo_url);
    let log_uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pipeline_log_dir =
        config
            .log_dir
            .join(format!("{}__{}__{}", repo_name, prd.slug(), log_uniq));
    std::fs::create_dir_all(&pipeline_log_dir)?;
    info!(
        repo = %repo_name,
        prd = %prd.title,
        agents = ?run_config.agents,
        logs = %pipeline_log_dir.display(),
        "starting pipeline"
    );

    // Clone / prepare repo
    let (workdir, was_empty) = git::clone_or_prepare(
        &run_config.repo_url,
        &run_config.work_dir,
        &run_config.base_branch,
    )
    .await?;

    // Dirty trees (sequential epics on a shared workdir, agent edits, or failed `stash pop`) block
    // `git checkout` during branch setup — stash first, like the pre-rebase path.
    let stashed_for_branch = if !was_empty {
        git::stash_workspace_if_dirty(&workdir).await?
    } else {
        false
    };

    let feature_branch_result: Result<String> = if was_empty {
        Ok(run_config.base_branch.clone())
    } else {
        let branch = prd
            .working_branch
            .clone()
            .unwrap_or_else(|| git::generate_branch_name(&prd.title));

        if let Some(stack_on) = &run_config.stack_on {
            info!(stack_on = %stack_on, "checking out stack-on branch");
            git::create_feature_branch(&workdir, stack_on, None).await?;
        }

        let start_point = run_config
            .stack_on
            .clone()
            .unwrap_or_else(|| format!("origin/{}", run_config.base_branch));
        git::create_feature_branch(&workdir, &branch, Some(&start_point)).await?;
        Ok(branch)
    };

    if stashed_for_branch {
        if feature_branch_result.is_ok() {
            info!("restoring stashed workspace changes after feature branch checkout");
        } else {
            warn!("feature branch setup failed — restoring stashed workspace changes");
        }
        git::pop_latest_stash(&workdir).await;
    }

    let feature_branch = feature_branch_result?;

    if !was_empty {
        if let Some(parent) = run_config.stack_on.as_deref() {
            if !run_config.skip_pr && !git::origin_branch_exists_on_remote(&workdir, parent).await?
            {
                anyhow::bail!(
                    "`origin/{target}` does not exist on the remote (see `git ls-remote --heads origin {target}`). \
                     For stacked work, push the parent feature branch (or merge its PR) before this subtask so the PR base exists on GitHub.",
                    target = parent
                );
            }
        }
    }

    // Write feature branch marker for orchestrator stacking
    let pipeline_dir = workdir.join(".pipeline");
    std::fs::create_dir_all(&pipeline_dir)?;
    std::fs::write(pipeline_dir.join("feature-branch"), &feature_branch)?;

    // Write git excludes
    git::write_git_excludes(&workdir)?;

    // Assemble context
    if let Some(ctx_path) = &run_config.context_path {
        let output = workdir.join(config.context_filename());
        context::write_context_file(ctx_path, &output)?;
        info!("assembled context -> {}", output.display());
    }

    // Copy PRD into .pipeline/
    let prd_copy = pipeline_dir.join("prd.md");
    std::fs::copy(&run_config.prd_path, &prd_copy)?;

    // `.agent-progress/` is gitignored — it survives branch switches in a reused workdir.
    // Without clearing, stale COMPLETED markers skip every agent (no logs, no commits, no PR).
    reset_agent_progress_for_prd(&workdir)?;

    // Run agents (stop reused Dev Container after the sequence; per-agent containers stop inside the loop)
    let mut shared_container: Option<DevContainer> = None;
    if run_config.use_devcontainer && run_config.reuse_devcontainer {
        shared_container = Some(DevContainer::start(&workdir).await?);
    }

    let agents_result = run_agent_sequence(
        run_config,
        config,
        provider,
        &workdir,
        &pipeline_log_dir,
        shared_container.as_ref(),
    )
    .await;

    if let Some(mut c) = shared_container.take() {
        c.stop().await;
    }

    agents_result?;

    if run_config.skip_pr || was_empty {
        if was_empty {
            info!("empty repo — pushing main instead of creating PR");
            crate::utils::exec_capture(
                "git",
                &["push", "-u", "origin", &run_config.base_branch],
                Some(&workdir),
            )
            .await?;
        }
        info!("pipeline complete (no PR)");
        return Ok(());
    }

    // Rebase and create PR
    let target = run_config
        .stack_on
        .as_deref()
        .unwrap_or(&run_config.base_branch);

    // Agents or a dirty tree from a prior run (e.g. failed `stash pop`) can leave HEAD on the wrong branch.
    git::create_feature_branch(&workdir, &feature_branch, None)
        .await
        .with_context(|| {
            format!(
                "could not check out feature branch {feature_branch} before rebase — clean conflicts or finish merge/rebase, then retry"
            )
        })?;

    if !git::origin_branch_exists_on_remote(&workdir, target).await? {
        anyhow::bail!(
            "`origin/{target}` does not exist on the remote (see `git ls-remote --heads origin {target}`). \
             For stacked work, push the parent feature branch (or merge its PR) before this subtask so the PR base exists on GitHub.",
            target = target
        );
    }
    git::fetch_origin_branch(&workdir, target).await?;

    let stashed = git::stash_workspace_if_dirty(&workdir).await?;

    let rebased = git::rebase_onto_latest(&workdir, target).await?;
    if !rebased {
        warn!("rebase failed — creating PR without rebase");
    }

    let commits_ahead = git::commits_ahead_of_remote_branch(&workdir, target).await?;
    if commits_ahead == 0 {
        if run_config.push_branch_for_downstream_stack && !run_config.skip_pr {
            info!(
                branch = %feature_branch,
                "pushing feature branch for downstream stacked work (no commits — skipping PR)"
            );
            git::push_head_to_origin_with_rebase_retry(&workdir, &feature_branch).await?;
        }
        warn!(
            base = %target,
            branch = %feature_branch,
            "no commits ahead of origin/{target} — skipping PR (nothing to merge). \
             Local feature branch may still exist but matches the base tip until agents commit. \
             Marking COMPLETED in `.agent-progress/` alone does not create commits."
        );
        if stashed {
            info!("restoring stashed workspace changes");
            git::pop_latest_stash(&workdir).await;
        }
        info!("pipeline complete (no PR)");
        return Ok(());
    }

    let pr_url = with_retry(3, std::time::Duration::from_secs(5), || async {
        git::create_pull_request(&workdir, target, &feature_branch, &prd.slug()).await
    })
    .await?;

    // Post evidence comments
    git::post_pr_evidence(&workdir, &pr_url, &prd.slug(), &run_config.evidence_agents).await?;

    if stashed {
        info!("restoring stashed workspace changes after push");
        git::pop_latest_stash(&workdir).await;
    }

    info!(pr = %pr_url, "pipeline complete");
    Ok(())
}

/// Runs the configured agent list. Separated from [`run`] so `bail!` / `return Err` do not skip Dev Container cleanup.
async fn run_agent_sequence(
    run_config: &PipelineRunConfig,
    config: &Config,
    provider: &dyn Provider,
    workdir: &Path,
    pipeline_log_dir: &Path,
    shared_devcontainer: Option<&DevContainer>,
) -> Result<()> {
    let agent_runner = AgentRunner::new(config, provider);
    let mut previous_agents: Vec<String> = Vec::new();

    for agent_name in &run_config.agents {
        let from_manifest = run_config
            .manifest_agent_max_iterations
            .for_agent(agent_name);
        let from_config = config.agent_max_iterations.for_agent(agent_name);
        let resolved = from_manifest
            .or(from_config)
            .unwrap_or(run_config.max_iterations);
        let effective_max = if resolved > 0 {
            resolved
        } else {
            run_config.max_iterations
        };

        info!(agent = %agent_name, "running agent");

        let mut per_agent_container: Option<DevContainer> = None;
        let dev_container: Option<&DevContainer> = if !run_config.use_devcontainer {
            None
        } else if run_config.reuse_devcontainer {
            shared_devcontainer
        } else {
            per_agent_container = Some(DevContainer::start(workdir).await?);
            per_agent_container.as_ref()
        };

        let outcome = agent_runner
            .run(
                agent_name,
                AgentRunParams {
                    workdir,
                    prd_path: &run_config.prd_path,
                    previous_agents: &previous_agents,
                    configured_max: effective_max,
                    interactive: run_config.interactive,
                    log_dir: pipeline_log_dir,
                    dev_container,
                },
            )
            .await;

        if let Some(mut c) = per_agent_container.take() {
            c.stop().await;
        }

        match outcome {
            Ok(AgentOutcome::Completed) => {
                info!(agent = %agent_name, "completed");
            }
            Ok(AgentOutcome::Skipped) => {
                info!(agent = %agent_name, "skipped by operator");
            }
            Ok(AgentOutcome::MaxIterationsReached) => {
                warn!(agent = %agent_name, "max iterations reached");
                if crate::pipeline::is_blocking(agent_name) {
                    anyhow::bail!("blocking agent {agent_name} did not complete");
                }
            }
            Ok(AgentOutcome::Failed(reason)) => {
                warn!(agent = %agent_name, reason = %reason, "failed");
                if crate::pipeline::is_blocking(agent_name) {
                    anyhow::bail!("blocking agent {agent_name} failed: {reason}");
                }
            }
            Err(e) => {
                warn!(agent = %agent_name, error = %e, "error running agent");
                if crate::pipeline::is_blocking(agent_name) {
                    return Err(e).with_context(|| format!("blocking agent {agent_name} failed"));
                }
            }
        }

        previous_agents.push(agent_name.clone());

        if run_config.interactive && atty::is(atty::Stream::Stdin) {
            use dialoguer::Select;
            let choice = Select::new()
                .with_prompt(format!("[pipeline] {agent_name} done. Continue?"))
                .items(&["Continue to next agent", "Abort pipeline"])
                .default(0)
                .interact()?;
            if choice == 1 {
                anyhow::bail!("pipeline aborted by operator after {agent_name}");
            }
        }
    }

    Ok(())
}

/// Remove prior PRD progress so Ralph loops do not treat leftover `.agent-progress/*.md` as done.
fn reset_agent_progress_for_prd(workdir: &std::path::Path) -> Result<()> {
    let dir = workdir.join(".agent-progress");
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    info!("reset .agent-progress for this PRD");
    Ok(())
}

async fn with_retry<F, Fut, T>(max_attempts: u32, delay: std::time::Duration, f: F) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut last_err = None;
    for attempt in 1..=max_attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                warn!(attempt, max_attempts, error = %e, "retrying");
                last_err = Some(e);
                if attempt < max_attempts {
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
    Err(last_err.unwrap())
}
