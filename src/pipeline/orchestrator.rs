use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info};

use crate::cli::OrchestrateArgs;
use crate::config::Config;
use crate::manifest::{Manifest, Order, PrdEntry};
use crate::prd::Prd;
use crate::provider::{self, Provider};
use crate::utils::repo_name_from_url;

use super::runner::{self, PipelineRunConfig};
use super::DEFAULT_AGENTS;

/// Shared inputs for executing one manifest order (PRDs run in sequence within the order).
struct OrderRunCtx<'a> {
    global_agents: &'a [String],
    config: &'a Config,
    provider: &'a dyn Provider,
    args: &'a OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &'a crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
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
    label: String,
}

/// Run the manifest orchestrator.
pub async fn run(args: &OrchestrateArgs, config: &Config) -> Result<()> {
    let manifest = Manifest::load(&args.manifest)?;

    info!(
        manifest = %manifest.display_name(),
        orders = manifest.orders.len(),
        "starting orchestration"
    );

    let order_range = match args.order {
        Some(n) => {
            if n == 0 || n > manifest.orders.len() {
                anyhow::bail!(
                    "order {n} out of range (manifest has {} orders)",
                    manifest.orders.len()
                );
            }
            (n - 1)..n
        }
        None => 0..manifest.orders.len(),
    };

    let order_indices: Vec<usize> = order_range.collect();

    let global_agents: Vec<String> = args
        .agents
        .clone()
        .unwrap_or_else(|| DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect());

    let pipeline_max_iterations = manifest.pipeline_max_iterations(config);
    let manifest_agent_max_iterations = manifest.manifest_agent_max_iterations();
    let global_sem = Arc::new(Semaphore::new(args.max_parallel.max(1)));
    let config_arc = Arc::new(config.clone());

    // Parallel orders stomp the same git workdir + logs when repos overlap — opt-in only.
    let parallel_orders = order_indices.len() > 1 && !args.sequential && args.parallel_orders;

    if order_indices.len() > 1 && !parallel_orders && !args.sequential {
        info!(
            "running manifest orders sequentially (shared workdir is unsafe for parallel orders). \
             Use --parallel-orders if each order targets an isolated clone."
        );
    }

    if !parallel_orders {
        let provider = provider::create_provider(config);
        for &order_idx in &order_indices {
            let order = &manifest.orders[order_idx];
            let default_name = format!("Order {}", order_idx + 1);
            let order_name = order.name.as_deref().unwrap_or(&default_name);

            info!(order = %order_name, "executing order");

            execute_order(
                order,
                OrderRunCtx {
                    global_agents: &global_agents,
                    config,
                    provider: &*provider,
                    args,
                    pipeline_max_iterations,
                    manifest_agent_max_iterations: &manifest_agent_max_iterations,
                    global_sem: global_sem.clone(),
                },
            )
            .await?;

            info!(order = %order_name, "order complete");
        }
    } else {
        let mut join_set = JoinSet::new();

        for order_idx in order_indices {
            let order = manifest.orders[order_idx].clone();
            let default_name = format!("Order {}", order_idx + 1);
            let order_name = order.name.clone().unwrap_or(default_name);
            let global_agents = global_agents.clone();
            let config = config_arc.clone();
            let args = args.clone();
            let global_sem = global_sem.clone();
            let manifest_iters = manifest_agent_max_iterations.clone();

            join_set.spawn(async move {
                info!(order = %order_name, "executing order");
                let provider = provider::create_provider(&config);
                let result = execute_order(
                    &order,
                    OrderRunCtx {
                        global_agents: &global_agents,
                        config: &config,
                        provider: &*provider,
                        args: &args,
                        pipeline_max_iterations,
                        manifest_agent_max_iterations: &manifest_iters,
                        global_sem,
                    },
                )
                .await;
                (order_name, result)
            });
        }

        let mut failures = Vec::new();

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((name, Ok(()))) => info!(order = %name, "order complete"),
                Ok((name, Err(e))) => {
                    error!(order = %name, error = %e, "order failed");
                    failures.push(format!("{name}: {e}"));
                }
                Err(e) => {
                    error!(error = %e, "order task panicked");
                    failures.push(format!("order task panic: {e}"));
                }
            }
        }

        if !failures.is_empty() {
            anyhow::bail!(
                "{} order(s) failed:\n{}",
                failures.len(),
                failures.join("\n")
            );
        }
    }

    info!("orchestration complete");
    Ok(())
}

async fn execute_order(order: &Order, ctx: OrderRunCtx<'_>) -> Result<()> {
    let mut last_branch_by_repo: HashMap<String, String> = HashMap::new();

    for prd_entry in &order.prds {
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
            )
            .await?;
        }

        refresh_branches_after_prd(prd_entry, &mut last_branch_by_repo);
    }

    Ok(())
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
            label: format!("{prd_name} x {repo_name}"),
        });
    }

    Ok(units)
}

/// After a PRD's pipelines finish, record feature branches per repo for stacking the next PRD.
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

async fn execute_units(
    units: &[WorkUnit],
    config: &Config,
    provider: &dyn Provider,
    args: &OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
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
                interactive,
                stack_on: unit.stack_on.clone(),
                evidence_agents,
                work_dir: config.work_dir.clone(),
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

async fn execute_single_unit(
    unit: &WorkUnit,
    config: &Config,
    provider: &dyn Provider,
    args: &OrchestrateArgs,
    pipeline_max_iterations: u32,
    manifest_agent_max_iterations: &crate::config::AgentIterationOverrides,
    global_sem: Arc<Semaphore>,
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
        interactive: args.interactive,
        stack_on: unit.stack_on.clone(),
        evidence_agents: args.evidence_agents.clone(),
        work_dir: config.work_dir.clone(),
    };

    runner::run(&run_config, config, provider).await?;

    info!(unit = %unit.label, "complete");
    Ok(())
}
