use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info};

use crate::cli::OrchestrateArgs;
use crate::config::Config;
use crate::manifest::{Epic, Manifest, PrdEntry};
use crate::prd::Prd;
use crate::provider::{self, Provider};
use crate::utils::repo_name_from_url;

use super::runner::{self, PipelineRunConfig};
use super::DEFAULT_AGENTS;

/// Shared inputs for executing one manifest epic (subtasks run in sequence within the epic).
struct EpicRunCtx<'a> {
    global_agents: &'a [String],
    config: &'a Config,
    provider: &'a dyn Provider,
    args: &'a OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &'a crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
    /// Clone root for this epic (`PIPELINE_WORK_DIR` or `{work_dir}/epics/{idx}` when epics run in parallel).
    pipeline_work_dir: PathBuf,
}

/// A single work unit: one PRD x one repo.
#[derive(Debug, Clone)]
struct WorkUnit {
    prd_path: PathBuf,
    repo_url: String,
    branch: String,
    context: Option<PathBuf>,
    agents: Vec<String>,
    stack_on: Option<String>,
    /// Push feature branch when this run produces no PR (0 commits) so downstream stacked work has `origin/<branch>`.
    push_branch_for_downstream_stack: bool,
    label: String,
}

/// Run the manifest orchestrator.
pub async fn run(args: &OrchestrateArgs, config: &Config) -> Result<()> {
    let manifest = Manifest::load(&args.manifest)?;

    info!(
        manifest = %manifest.display_name(),
        epics = manifest.epics.len(),
        "starting orchestration"
    );

    let epic_range = match args.epic {
        Some(n) => {
            if n == 0 || n > manifest.epics.len() {
                anyhow::bail!(
                    "epic {n} out of range (manifest has {} epics)",
                    manifest.epics.len()
                );
            }
            (n - 1)..n
        }
        None => 0..manifest.epics.len(),
    };

    let epic_indices: Vec<usize> = epic_range.collect();

    let global_agents: Vec<String> = args
        .agents
        .clone()
        .unwrap_or_else(|| DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect());

    let pipeline_max_iterations = manifest.pipeline_max_iterations(config);
    let manifest_agent_max_iterations = manifest.manifest_agent_max_iterations();
    let global_sem = Arc::new(Semaphore::new(args.max_parallel.max(1)));
    let config_arc = Arc::new(config.clone());

    let parallel_epics = epic_indices.len() > 1 && !args.sequential && !args.sequential_epics;

    if epic_indices.len() > 1 && !parallel_epics {
        info!("running manifest epics sequentially (--sequential-epics and/or --sequential)");
    }

    if !parallel_epics {
        let provider = provider::create_provider(config);
        let pipeline_work_dir = config.work_dir.clone();
        for &epic_idx in &epic_indices {
            let epic = &manifest.epics[epic_idx];
            let default_name = format!("Epic {}", epic_idx + 1);
            let epic_name = epic.name.as_deref().unwrap_or(&default_name);

            info!(epic = %epic_name, "executing epic");

            execute_epic(
                epic,
                EpicRunCtx {
                    global_agents: &global_agents,
                    config,
                    provider: &*provider,
                    args,
                    pipeline_max_iterations,
                    manifest_agent_max_iterations: &manifest_agent_max_iterations,
                    global_sem: global_sem.clone(),
                    pipeline_work_dir: pipeline_work_dir.clone(),
                },
            )
            .await?;

            info!(epic = %epic_name, "epic complete");
        }
    } else {
        let mut join_set = JoinSet::new();

        for epic_idx in epic_indices {
            let epic = manifest.epics[epic_idx].clone();
            let default_name = format!("Epic {}", epic_idx + 1);
            let epic_name = epic.name.clone().unwrap_or(default_name);
            let global_agents = global_agents.clone();
            let config = config_arc.clone();
            let args = args.clone();
            let global_sem = global_sem.clone();
            let manifest_iters = manifest_agent_max_iterations.clone();
            let pipeline_work_dir = config.work_dir.join("epics").join(format!("{epic_idx:03}"));

            join_set.spawn(async move {
                info!(epic = %epic_name, "executing epic");
                let provider = provider::create_provider(&config);
                let result = execute_epic(
                    &epic,
                    EpicRunCtx {
                        global_agents: &global_agents,
                        config: &config,
                        provider: &*provider,
                        args: &args,
                        pipeline_max_iterations,
                        manifest_agent_max_iterations: &manifest_iters,
                        global_sem,
                        pipeline_work_dir,
                    },
                )
                .await;
                (epic_name, result)
            });
        }

        let mut failures = Vec::new();

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((name, Ok(()))) => info!(epic = %name, "epic complete"),
                Ok((name, Err(e))) => {
                    error!(epic = %name, error = %e, "epic failed");
                    failures.push(format!("{name}: {e}"));
                }
                Err(e) => {
                    error!(error = %e, "epic task panicked");
                    failures.push(format!("epic task panic: {e}"));
                }
            }
        }

        if !failures.is_empty() {
            anyhow::bail!(
                "{} epic(s) failed:\n{}",
                failures.len(),
                failures.join("\n")
            );
        }
    }

    info!("orchestration complete");
    Ok(())
}

async fn execute_epic(epic: &Epic, ctx: EpicRunCtx<'_>) -> Result<()> {
    let mut last_branch_by_repo: HashMap<String, String> = HashMap::new();

    for (subtask_idx, prd_entry) in epic.subtasks.iter().enumerate() {
        let mut work_units = build_work_units_for_prd(prd_entry, ctx.global_agents)?;

        if work_units.is_empty() {
            continue;
        }

        for unit in &mut work_units {
            let repo = repo_name_from_url(&unit.repo_url);
            if let Some(branch) = last_branch_by_repo.get(&repo) {
                unit.stack_on = Some(branch.clone());
            }
        }

        annotate_push_for_downstream_stack(epic, subtask_idx, &mut work_units);

        let needs_stacking = detect_same_repo_conflicts(&work_units);

        if needs_stacking {
            let waves = split_into_waves(&work_units);
            for (wave_idx, wave) in waves.iter().enumerate() {
                info!(
                    wave = wave_idx + 1,
                    total = waves.len(),
                    units = wave.len(),
                    "executing wave"
                );
                execute_units(
                    wave,
                    ctx.config,
                    ctx.provider,
                    ctx.args,
                    ctx.pipeline_max_iterations,
                    ctx.manifest_agent_max_iterations,
                    ctx.global_sem.clone(),
                    ctx.pipeline_work_dir.clone(),
                )
                .await?;
            }
        } else {
            execute_units(
                &work_units,
                ctx.config,
                ctx.provider,
                ctx.args,
                ctx.pipeline_max_iterations,
                ctx.manifest_agent_max_iterations,
                ctx.global_sem.clone(),
                ctx.pipeline_work_dir.clone(),
            )
            .await?;
        }

        refresh_branches_after_prd(prd_entry, &mut last_branch_by_repo);
    }

    Ok(())
}

/// Sets [`WorkUnit::push_branch_for_downstream_stack`] when another unit will stack on this branch:
/// a later entry for the same repo in this subtask (stacking waves), or a later epic subtask that uses the same repo.
fn annotate_push_for_downstream_stack(
    epic: &Epic,
    subtask_idx: usize,
    work_units: &mut [WorkUnit],
) {
    let n = work_units.len();
    let mut later_same_repo_in_prd = vec![false; n];
    for idx in 0..n {
        let repo = repo_name_from_url(&work_units[idx].repo_url);
        later_same_repo_in_prd[idx] = work_units[idx + 1..]
            .iter()
            .any(|u| repo_name_from_url(&u.repo_url) == repo);
    }
    for (idx, unit) in work_units.iter_mut().enumerate() {
        let repo = repo_name_from_url(&unit.repo_url);
        let later_subtask_same_repo = epic.subtasks[subtask_idx + 1..].iter().any(|p| {
            p.repositories
                .iter()
                .any(|r| repo_name_from_url(&r.url) == repo)
        });
        unit.push_branch_for_downstream_stack =
            later_same_repo_in_prd[idx] || later_subtask_same_repo;
    }
}

fn build_work_units_for_prd(
    prd_entry: &PrdEntry,
    global_agents: &[String],
) -> Result<Vec<WorkUnit>> {
    if let Ok(prd) = Prd::load(&prd_entry.prd) {
        if prd.is_done() {
            info!(prd = %prd.title, "skipping (done)");
            return Ok(Vec::new());
        }
    }

    let mut units = Vec::new();
    let prd_agents: Vec<String> = prd_entry.agents.clone().unwrap_or_default();

    for repo in &prd_entry.repositories {
        let repo_agents: Vec<String> = repo.agents.clone().unwrap_or_default();

        let agents = if !prd_agents.is_empty() || !repo_agents.is_empty() {
            let mut combined = prd_agents.clone();
            combined.extend(repo_agents);
            combined
        } else {
            global_agents.to_vec()
        };

        let repo_name = repo_name_from_url(&repo.url);
        let prd_name = prd_entry
            .prd
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("prd");

        units.push(WorkUnit {
            prd_path: prd_entry.prd.clone(),
            repo_url: repo.url.clone(),
            branch: repo.branch.clone(),
            context: repo.context.clone(),
            agents,
            stack_on: None,
            push_branch_for_downstream_stack: false,
            label: format!("{prd_name} x {repo_name}"),
        });
    }

    Ok(units)
}

/// After a PRD's pipelines finish, record feature branches per repo for stacking the next subtask.
fn refresh_branches_after_prd(
    prd_entry: &PrdEntry,
    last_branch_by_repo: &mut HashMap<String, String>,
) {
    let Ok(prd) = Prd::load(&prd_entry.prd) else {
        return;
    };
    let branch = prd
        .working_branch
        .unwrap_or_else(|| crate::git::generate_branch_name(&prd.title));

    for repo in &prd_entry.repositories {
        let repo_name = repo_name_from_url(&repo.url);
        last_branch_by_repo.insert(repo_name, branch.clone());
    }
}

fn detect_same_repo_conflicts(units: &[WorkUnit]) -> bool {
    let mut seen = std::collections::HashSet::new();
    for unit in units {
        let repo = repo_name_from_url(&unit.repo_url);
        if !seen.insert(repo) {
            return true;
        }
    }
    false
}

/// Split work units into waves for same-repo stacking.
/// Wave 0: first unit per repo; Wave 1: second unit per repo; etc.
fn split_into_waves(units: &[WorkUnit]) -> Vec<Vec<WorkUnit>> {
    let mut repo_queues: HashMap<String, Vec<WorkUnit>> = HashMap::new();
    for unit in units {
        let repo = repo_name_from_url(&unit.repo_url);
        repo_queues.entry(repo).or_default().push(unit.clone());
    }

    let max_depth = repo_queues.values().map(|v| v.len()).max().unwrap_or(0);
    let mut waves: Vec<Vec<WorkUnit>> = Vec::new();

    for wave_idx in 0..max_depth {
        let mut wave = Vec::new();
        for queue in repo_queues.values_mut() {
            if wave_idx < queue.len() {
                let mut unit = queue[wave_idx].clone();

                // If this isn't the first wave, stack on the previous unit's branch
                if wave_idx > 0 {
                    let prev_unit = &queue[wave_idx - 1];
                    if let Ok(prd) = Prd::load(&prev_unit.prd_path) {
                        let prev_branch = prd
                            .working_branch
                            .unwrap_or_else(|| crate::git::generate_branch_name(&prd.title));
                        unit.stack_on = Some(prev_branch);
                    }
                }

                wave.push(unit);
            }
        }
        waves.push(wave);
    }

    waves
}

#[allow(clippy::too_many_arguments)]
async fn execute_units(
    units: &[WorkUnit],
    config: &Config,
    provider: &dyn Provider,
    args: &OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
    pipeline_work_dir: PathBuf,
) -> Result<()> {
    if args.sequential || units.len() == 1 {
        for unit in units {
            execute_single_unit(
                unit,
                config,
                provider,
                args,
                pipeline_max_iterations,
                manifest_agent_max_iterations,
                global_sem.clone(),
                pipeline_work_dir.clone(),
            )
            .await?;
        }
        return Ok(());
    }

    let mut join_set = JoinSet::new();

    // We need to clone config and recreate provider for each task since they
    // need to be 'static. The provider is cheap to recreate.
    let config = Arc::new(config.clone());

    let manifest_iters = manifest_agent_max_iterations.clone();

    for unit in units.iter().cloned() {
        let sem = global_sem.clone();
        let config = config.clone();
        let skip_pr = args.skip_pr;
        let interactive = args.interactive;
        let evidence_agents = args.evidence_agents.clone();
        let manifest_iters = manifest_iters.clone();
        let pipeline_work_dir = pipeline_work_dir.clone();
        join_set.spawn(async move {
            let _permit = sem.acquire().await.expect("semaphore closed unexpectedly");

            let provider = provider::create_provider(&config);

            let run_config = PipelineRunConfig {
                prd_path: unit.prd_path.clone(),
                repo_url: unit.repo_url.clone(),
                base_branch: unit.branch.clone(),
                context_path: unit.context.clone(),
                agents: unit.agents.clone(),
                max_iterations: pipeline_max_iterations,
                manifest_agent_max_iterations: manifest_iters.clone(),
                skip_pr,
                use_devcontainer: config.use_devcontainer,
                reuse_devcontainer: config.reuse_devcontainer,
                interactive,
                stack_on: unit.stack_on.clone(),
                push_branch_for_downstream_stack: unit.push_branch_for_downstream_stack,
                evidence_agents,
                work_dir: pipeline_work_dir,
            };

            let result = runner::run(&run_config, &config, &*provider).await;
            (unit.label.clone(), result)
        });
    }

    let mut failures = Vec::new();

    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((label, Ok(()))) => {
                info!(unit = %label, "completed successfully");
            }
            Ok((label, Err(e))) => {
                error!(unit = %label, error = %e, "failed");
                failures.push(format!("{label}: {e}"));
            }
            Err(e) => {
                error!(error = %e, "task panicked");
                failures.push(format!("task panic: {e}"));
            }
        }
    }

    if !failures.is_empty() {
        anyhow::bail!(
            "{} work unit(s) failed:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn execute_single_unit(
    unit: &WorkUnit,
    config: &Config,
    provider: &dyn Provider,
    args: &OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
    pipeline_work_dir: PathBuf,
) -> Result<()> {
    let _permit = global_sem
        .acquire()
        .await
        .expect("semaphore closed unexpectedly");

    info!(unit = %unit.label, "executing");

    let run_config = PipelineRunConfig {
        prd_path: unit.prd_path.clone(),
        repo_url: unit.repo_url.clone(),
        base_branch: unit.branch.clone(),
        context_path: unit.context.clone(),
        agents: unit.agents.clone(),
        max_iterations: pipeline_max_iterations,
        manifest_agent_max_iterations: manifest_agent_max_iterations.clone(),
        skip_pr: args.skip_pr,
        use_devcontainer: config.use_devcontainer,
        reuse_devcontainer: config.reuse_devcontainer,
        interactive: args.interactive,
        stack_on: unit.stack_on.clone(),
        push_branch_for_downstream_stack: unit.push_branch_for_downstream_stack,
        evidence_agents: args.evidence_agents.clone(),
        work_dir: pipeline_work_dir,
    };

    runner::run(&run_config, config, provider).await?;

    info!(unit = %unit.label, "complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{Epic, PrdEntry, Repository};

    fn unit(repo_suffix: &str) -> WorkUnit {
        WorkUnit {
            prd_path: PathBuf::from("a.md"),
            repo_url: format!("https://github.com/o/{repo_suffix}"),
            branch: "main".into(),
            context: None,
            agents: vec![],
            stack_on: None,
            push_branch_for_downstream_stack: false,
            label: repo_suffix.to_string(),
        }
    }

    #[test]
    fn annotate_later_wave_same_repo_sets_push_on_first_only() {
        let epic = Epic {
            name: None,
            description: None,
            subtasks: vec![PrdEntry {
                prd: PathBuf::from("a.md"),
                agents: None,
                repositories: vec![Repository {
                    url: "https://github.com/o/r".into(),
                    branch: "main".into(),
                    context: None,
                    agents: None,
                }],
            }],
        };
        let mut wu = vec![unit("r"), unit("r")];
        annotate_push_for_downstream_stack(&epic, 0, &mut wu);
        assert!(wu[0].push_branch_for_downstream_stack);
        assert!(!wu[1].push_branch_for_downstream_stack);
    }

    #[test]
    fn annotate_later_epic_subtask_sets_push_on_first_subtask_only() {
        let epic = Epic {
            name: None,
            description: None,
            subtasks: vec![
                PrdEntry {
                    prd: PathBuf::from("a.md"),
                    agents: None,
                    repositories: vec![Repository {
                        url: "https://github.com/o/wisp".into(),
                        branch: "main".into(),
                        context: None,
                        agents: None,
                    }],
                },
                PrdEntry {
                    prd: PathBuf::from("b.md"),
                    agents: None,
                    repositories: vec![Repository {
                        url: "https://github.com/o/wisp".into(),
                        branch: "main".into(),
                        context: None,
                        agents: None,
                    }],
                },
            ],
        };
        let mut first = vec![unit("wisp")];
        annotate_push_for_downstream_stack(&epic, 0, &mut first);
        assert!(first[0].push_branch_for_downstream_stack);

        let mut second = vec![unit("wisp")];
        annotate_push_for_downstream_stack(&epic, 1, &mut second);
        assert!(!second[0].push_branch_for_downstream_stack);
    }
}
