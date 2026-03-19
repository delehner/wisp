use std::path::PathBuf;

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::config::Config;
use crate::context;
use crate::git;
use crate::pipeline::agent::{AgentOutcome, AgentRunner};
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
    pub max_iterations: u32,
    pub skip_pr: bool,
    pub use_devcontainer: bool,
    pub interactive: bool,
    pub stack_on: Option<String>,
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
    info!(
        repo = %repo_name,
        prd = %prd.title,
        agents = ?run_config.agents,
        "starting pipeline"
    );

    // Clone / prepare repo
    let (workdir, was_empty) = git::clone_or_prepare(
        &run_config.repo_url,
        &run_config.work_dir,
        &run_config.base_branch,
    )
    .await?;

    // Set up branch
    let feature_branch = if was_empty {
        run_config.base_branch.clone()
    } else {
        let branch = prd
            .working_branch
            .clone()
            .unwrap_or_else(|| git::generate_branch_name(&prd.title));

        if let Some(stack_on) = &run_config.stack_on {
            info!(stack_on = %stack_on, "checking out stack-on branch");
            git::create_feature_branch(&workdir, stack_on).await?;
        }

        git::create_feature_branch(&workdir, &branch).await?;
        branch
    };

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

    // Run agents
    let mut container: Option<DevContainer> = None;

    if run_config.use_devcontainer {
        container = Some(DevContainer::start(&workdir).await?);
    }

    let agent_runner = AgentRunner::new(config, provider);
    let mut previous_agents: Vec<String> = Vec::new();

    for agent_name in &run_config.agents {
        let max_iter = config.max_iterations_for_agent(agent_name);
        let effective_max = if max_iter > 0 {
            max_iter
        } else {
            run_config.max_iterations
        };

        info!(agent = %agent_name, "running agent");

        let outcome = agent_runner
            .run(
                agent_name,
                &workdir,
                &run_config.prd_path,
                &previous_agents,
                effective_max,
                run_config.interactive,
            )
            .await;

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

    // Stop container before git operations
    if let Some(c) = container.take() {
        c.stop().await;
    }

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
    let rebased = git::rebase_onto_latest(&workdir, target).await?;
    if !rebased {
        warn!("rebase failed — creating PR without rebase");
    }

    let pr_url = with_retry(3, std::time::Duration::from_secs(5), || async {
        git::create_pull_request(&workdir, target, &prd.slug()).await
    })
    .await?;

    // Post evidence comments
    git::post_pr_evidence(&workdir, &pr_url, &prd.slug(), &run_config.evidence_agents).await?;

    info!(pr = %pr_url, "pipeline complete");
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
