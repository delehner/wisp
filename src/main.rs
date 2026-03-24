#![allow(dead_code)]

mod cli;
mod config;
mod context;
mod git;
mod install;
mod logging;
mod manifest;
mod pipeline;
mod prd;
mod provider;
mod utils;

use std::io::BufReader;

use anyhow::Result;
use clap::Parser;

use cli::{Cli, Commands, GenerateCmd, InstallCmd};
use config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut config = Config::load();

    // CLI --provider overrides .env
    config.provider = cli.provider;

    logging::init(&config.log_level);

    match cli.command {
        Commands::Orchestrate(args) => {
            config.verbose_logs = args.verbose_logs || config.verbose_logs;
            config.interactive = args.interactive || config.interactive;
            config.work_dir = args.work_dir.clone();
            config.max_iterations = args.max_iterations;
            config.max_parallel = args.max_parallel;
            config.reuse_devcontainer = args.reuse_devcontainer || config.reuse_devcontainer;
            pipeline::orchestrator::run(&args, &config).await?;
        }

        Commands::Pipeline(args) => {
            config.verbose_logs = args.verbose_logs || config.verbose_logs;
            config.interactive = args.interactive || config.interactive;
            config.work_dir = args.work_dir.clone();
            config.max_iterations = args.max_iterations;

            let agents = args.agents.clone().unwrap_or_else(|| {
                pipeline::DEFAULT_AGENTS
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            });

            let run_config = pipeline::runner::PipelineRunConfig {
                prd_path: args.prd.clone(),
                repo_url: args.repo.clone(),
                base_branch: args.branch.clone(),
                context_path: args.context.clone(),
                agents,
                max_iterations: args.max_iterations,
                manifest_agent_max_iterations: Default::default(),
                skip_pr: args.skip_pr,
                use_devcontainer: !args.no_devcontainer && config.use_devcontainer,
                reuse_devcontainer: args.reuse_devcontainer || config.reuse_devcontainer,
                interactive: config.interactive,
                stack_on: args.stack_on.clone(),
                push_branch_for_downstream_stack: false,
                evidence_agents: args.evidence_agents.clone(),
                work_dir: args.work_dir.clone(),
            };

            let provider = provider::create_provider(&config);
            pipeline::runner::run(&run_config, &config, &*provider).await?;
        }

        Commands::Run(args) => {
            config.verbose_logs = args.verbose_logs || config.verbose_logs;
            config.interactive = args.interactive || config.interactive;

            let provider = provider::create_provider(&config);
            let runner = pipeline::agent::AgentRunner::new(&config, &*provider);

            let previous = args.previous_agents.clone().unwrap_or_default();
            let max_iter = config.max_iterations_for_agent(&args.agent);
            let effective_max = if args.max_iterations != 10 {
                args.max_iterations
            } else {
                max_iter
            };

            let prd_slug = prd::Prd::load(&args.prd)
                .map(|p| p.slug())
                .unwrap_or_else(|_| {
                    args.prd
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("prd")
                        .to_string()
                });
            let log_uniq = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let agent_log_dir = config.log_dir.join(format!(
                "single__{}__{}__{}",
                args.agent, prd_slug, log_uniq
            ));
            std::fs::create_dir_all(&agent_log_dir)?;
            tracing::info!(logs = %agent_log_dir.display(), "single-agent run logs");

            let outcome = runner
                .run(
                    &args.agent,
                    pipeline::agent::AgentRunParams {
                        workdir: &args.workdir,
                        prd_path: &args.prd,
                        previous_agents: &previous,
                        configured_max: effective_max,
                        interactive: config.interactive,
                        log_dir: &agent_log_dir,
                        dev_container: None,
                    },
                )
                .await?;

            match outcome {
                pipeline::agent::AgentOutcome::Completed => {
                    tracing::info!(agent = %args.agent, "completed");
                }
                pipeline::agent::AgentOutcome::MaxIterationsReached => {
                    tracing::warn!(agent = %args.agent, "max iterations reached");
                    std::process::exit(1);
                }
                pipeline::agent::AgentOutcome::Skipped => {
                    tracing::info!(agent = %args.agent, "skipped");
                }
                pipeline::agent::AgentOutcome::Failed(reason) => {
                    tracing::error!(agent = %args.agent, reason = %reason, "failed");
                    std::process::exit(1);
                }
            }
        }

        Commands::Generate { cmd } => match cmd {
            GenerateCmd::Prd(args) => {
                config.verbose_logs = args.verbose_logs || config.verbose_logs;
                run_generate_prd(&args, &config).await?;
            }
            GenerateCmd::Context(args) => {
                config.verbose_logs = args.verbose_logs || config.verbose_logs;
                run_generate_context(&args, &config).await?;
            }
        },

        Commands::Monitor(args) => {
            if args.sessions {
                logging::monitor::list_sessions(&args.log_dir).await?;
            } else {
                let cancel = tokio_util::sync::CancellationToken::new();
                let cancel_clone = cancel.clone();

                tokio::spawn(async move {
                    tokio::signal::ctrl_c().await.ok();
                    cancel_clone.cancel();
                });

                logging::monitor::tail_logs(
                    &args.log_dir,
                    args.agent.as_deref(),
                    args.raw,
                    config.provider,
                    cancel,
                )
                .await?;
            }
        }

        Commands::Logs(args) => {
            let file = std::fs::File::open(&args.file)
                .with_context(|| format!("failed to open: {}", args.file.display()))?;
            let reader = BufReader::new(file);

            // Auto-detect provider from first line
            let peek_content = std::fs::read_to_string(&args.file).unwrap_or_default();
            let detected = peek_content
                .lines()
                .find_map(logging::formatter::detect_provider)
                .unwrap_or(config.provider);

            let mut stdout = std::io::stdout().lock();
            logging::formatter::format_jsonl_stream(reader, &mut stdout, detected, args.truncate);
        }

        Commands::Install { cmd } => match cmd {
            InstallCmd::Skills(args) => {
                install_skills(&args, &config)?;
            }
            InstallCmd::Agents(args) => {
                install::agents::run(&args).await?;
            }
        },

        Commands::Update => {
            tracing::info!("self-update not yet implemented — install the latest version manually");
            tracing::info!("  cargo install wisp");
            tracing::info!("  # or re-run the install script");
        }
    }

    Ok(())
}

fn collect_project_description(args: &cli::GeneratePrdArgs) -> Result<String> {
    if let Some(ref d) = args.description {
        let s = d.trim().to_string();
        if s.is_empty() {
            anyhow::bail!("--description cannot be empty");
        }
        return Ok(s);
    }

    if atty::is(atty::Stream::Stdin) {
        let description = dialoguer::Input::<String>::new()
            .with_prompt("Describe what you want to build (goals, features, constraints)")
            .allow_empty(false)
            .interact_text()
            .map_err(|e| anyhow::anyhow!("failed to read description: {e}"))?;
        let s = description.trim().to_string();
        if s.is_empty() {
            anyhow::bail!("Description cannot be empty");
        }
        return Ok(s);
    }

    // Read from stdin (e.g. echo "Build X" | wisp generate prd ...)
    let mut buf = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf)
        .map_err(|e| anyhow::anyhow!("failed to read from stdin: {e}"))?;
    let s = buf.trim().to_string();
    if s.is_empty() {
        anyhow::bail!(
            "No project description provided. Use --description \"...\" or run interactively."
        );
    }
    Ok(s)
}

async fn run_generate_prd(args: &cli::GeneratePrdArgs, config: &Config) -> Result<()> {
    use crate::provider;

    let description = collect_project_description(args)?;

    let provider = provider::create_provider(config);
    let root = &config.root_dir;

    let manifest_path = crate::manifest::normalize_generate_prd_manifest_path(&args.manifest);

    std::fs::create_dir_all(&args.output)?;

    // Build prompt from prd-generator agent
    let mut prompt = String::new();

    let base_path = root.join("agents/_base-system.md");
    if base_path.is_file() {
        prompt.push_str(&std::fs::read_to_string(&base_path)?);
        prompt.push('\n');
    }

    let gen_prompt = root.join("agents/prd-generator/prompt.md");
    if gen_prompt.is_file() {
        prompt.push_str(&std::fs::read_to_string(&gen_prompt)?);
        prompt.push('\n');
    }

    // Project description from user — required for the agent to know what to build
    prompt.push_str("\n## Project Description (from user)\n\n");
    prompt.push_str(&description);
    prompt.push_str("\n\n");

    // Add repo contexts
    for (i, repo_url) in args.repos.iter().enumerate() {
        prompt.push_str(&format!("\n## Repository: {repo_url}\n\n"));
        if let Some(ctx_path) = args.contexts.get(i) {
            let content = context::assemble_skills(ctx_path)?;
            prompt.push_str(&content);
            prompt.push('\n');
        }
    }

    prompt.push_str(&format!(
        "\nOutput PRD files to: {}\nOutput manifest to: {}\n",
        args.output.display(),
        manifest_path.display()
    ));

    // Write prompt to temp file and run
    let prompt_file = std::env::temp_dir().join("wisp-generate-prd-prompt.md");
    std::fs::write(&prompt_file, &prompt)?;

    let model = config.default_model().to_string();
    let opts = provider::RunOpts {
        model,
        allowed_tools: config.claude_allowed_tools.clone(),
        output_format: "stream-json".into(),
        verbose: config.verbose_logs,
        log_jsonl: Some(config.log_dir.join("prd_generator_iteration_1.jsonl")),
        log_formatted: Some(config.log_dir.join("prd_generator_iteration_1.log")),
        resume_session_id: None,
        prompt_inline: None,
    };

    let cli_args = provider.build_run_args(&prompt_file, &opts);
    let exit_code = crate::utils::exec_streaming(
        provider.cli_name(),
        &cli_args,
        None,
        &[],
        |line| print!("{line}"),
        |line| eprint!("{line}"),
    )
    .await?;

    let _ = std::fs::remove_file(&prompt_file);

    if exit_code != 0 {
        anyhow::bail!("PRD generation failed with exit code {exit_code}");
    }

    crate::manifest::inject_iteration_defaults(&manifest_path, config)?;

    tracing::info!("PRD generation complete");
    Ok(())
}

async fn run_generate_context(args: &cli::GenerateContextArgs, config: &Config) -> Result<()> {
    use crate::provider;

    let provider = provider::create_provider(config);
    let root = &config.root_dir;

    std::fs::create_dir_all(&args.output)?;

    // Resolve to absolute path so the agent writes to the correct location.
    // The agent runs with cwd = cloned repo; a relative path would be wrong.
    let output_abs = args
        .output
        .canonicalize()
        .with_context(|| format!("failed to resolve output path: {}", args.output.display()))?;

    let work_dir = config.work_dir.join("context-gen");
    let (workdir, _) = git::clone_or_prepare(&args.repo, &work_dir, &args.branch).await?;

    // Build prompt
    let mut prompt = String::new();

    let base_path = root.join("agents/_base-system.md");
    if base_path.is_file() {
        prompt.push_str(&std::fs::read_to_string(&base_path)?);
        prompt.push('\n');
    }

    let gen_prompt = root.join("agents/context-generator/prompt.md");
    if gen_prompt.is_file() {
        prompt.push_str(&std::fs::read_to_string(&gen_prompt)?);
        prompt.push('\n');
    }

    prompt.push_str(&format!(
        "\nRepository: {}\nOutput context skills to: {}\n",
        args.repo,
        output_abs.display()
    ));

    let prompt_file = std::env::temp_dir().join("wisp-generate-context-prompt.md");
    std::fs::write(&prompt_file, &prompt)?;

    let model = config.default_model().to_string();
    let opts = provider::RunOpts {
        model,
        allowed_tools: config.claude_allowed_tools.clone(),
        output_format: "stream-json".into(),
        verbose: config.verbose_logs,
        log_jsonl: Some(config.log_dir.join("context_generator_iteration_1.jsonl")),
        log_formatted: Some(config.log_dir.join("context_generator_iteration_1.log")),
        resume_session_id: None,
        prompt_inline: None,
    };

    let cli_args = provider.build_run_args(&prompt_file, &opts);
    let exit_code = crate::utils::exec_streaming(
        provider.cli_name(),
        &cli_args,
        Some(&workdir),
        &[],
        |line| print!("{line}"),
        |line| eprint!("{line}"),
    )
    .await?;

    let _ = std::fs::remove_file(&prompt_file);

    if exit_code != 0 {
        anyhow::bail!("context generation failed with exit code {exit_code}");
    }

    tracing::info!("context generation complete");
    Ok(())
}

fn install_skills(args: &cli::InstallSkillsArgs, config: &Config) -> Result<()> {
    let skills_src = config.root_dir.join("skills");
    if !skills_src.is_dir() {
        anyhow::bail!("skills directory not found: {}", skills_src.display());
    }

    let target_dir = match &args.project {
        Some(project) => project.join(".cursor/skills"),
        None => {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            std::path::PathBuf::from(home).join(".cursor/skills")
        }
    };

    std::fs::create_dir_all(&target_dir)?;
    tracing::info!(src = %skills_src.display(), target = %target_dir.display(), "installing skills");

    let entries = std::fs::read_dir(&skills_src)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let target = target_dir.join(&name);

        if target.is_symlink() {
            std::fs::remove_file(&target)?;
            tracing::info!(skill = %name, "updating symlink");
        } else if target.is_dir() {
            tracing::info!(skill = %name, "skipping (directory exists, not a symlink)");
            continue;
        } else {
            tracing::info!(skill = %name, "installing");
        }

        let canonical = std::fs::canonicalize(&path)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(&canonical, &target)?;
        #[cfg(not(unix))]
        std::fs::copy(&canonical, &target).map(|_| ())?;
    }

    tracing::info!("skills installed");
    Ok(())
}

use anyhow::Context as _;
