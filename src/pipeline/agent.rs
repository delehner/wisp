use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::config::Config;
use crate::provider::{Provider, RunOpts};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentOutcome {
    Completed,
    MaxIterationsReached,
    Skipped,
    Failed(String),
}

pub struct AgentRunner<'a> {
    config: &'a Config,
    provider: &'a dyn Provider,
}

impl<'a> AgentRunner<'a> {
    pub fn new(config: &'a Config, provider: &'a dyn Provider) -> Self {
        Self { config, provider }
    }

    /// Run the Ralph Loop for a single agent.
    pub async fn run(
        &self,
        agent: &str,
        workdir: &Path,
        prd_path: &Path,
        previous_agents: &[String],
        max_iterations: u32,
        interactive: bool,
    ) -> Result<AgentOutcome> {
        let progress_dir = workdir.join(".agent-progress");
        std::fs::create_dir_all(&progress_dir)?;

        let log_dir = &self.config.log_dir;
        std::fs::create_dir_all(log_dir)?;

        for iteration in 1..=max_iterations {
            if self.is_completed(agent, workdir)? {
                info!(agent, "already completed");
                return Ok(AgentOutcome::Completed);
            }

            info!(agent, iteration, max_iterations, "starting iteration");

            let prompt_file = self.build_prompt(
                agent,
                workdir,
                prd_path,
                previous_agents,
                iteration,
                max_iterations,
            )?;

            let model = self.config.model_for_agent(agent);
            let opts = RunOpts {
                model,
                allowed_tools: self.config.claude_allowed_tools.clone(),
                output_format: "stream-json".into(),
                verbose: self.config.verbose_logs,
                log_jsonl: Some(log_dir.join(format!("{agent}_iteration_{iteration}.jsonl"))),
                log_formatted: Some(log_dir.join(format!("{agent}_iteration_{iteration}.log"))),
            };

            let args = self.provider.build_run_args(&prompt_file, &opts);
            let exit_code = self.execute_cli(agent, &args, workdir, &opts).await?;

            // Clean up temp prompt file
            let _ = std::fs::remove_file(&prompt_file);

            // Save session ID
            if let Some(jsonl_path) = &opts.log_jsonl {
                if jsonl_path.is_file() {
                    let lines: Vec<String> = std::fs::read_to_string(jsonl_path)
                        .unwrap_or_default()
                        .lines()
                        .map(|l| l.to_string())
                        .collect();
                    if let Some(session_id) = self.provider.extract_session_id(&lines) {
                        let session_file =
                            log_dir.join(format!("{agent}_iteration_{iteration}.session"));
                        let _ = std::fs::write(&session_file, &session_id);
                    }
                }
            }

            if exit_code != 0 {
                warn!(agent, exit_code, iteration, "CLI exited with non-zero code");
            }

            if self.is_completed(agent, workdir)? {
                info!(agent, iteration, "completed");
                return Ok(AgentOutcome::Completed);
            }

            if interactive && atty::is(atty::Stream::Stdin) {
                match prompt_interactive(agent, iteration)? {
                    InteractiveChoice::Continue => {}
                    InteractiveChoice::Skip => return Ok(AgentOutcome::Skipped),
                    InteractiveChoice::Abort => {
                        return Ok(AgentOutcome::Failed("aborted by operator".into()));
                    }
                }
            }

            if iteration < max_iterations {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }

        warn!(
            agent,
            max_iterations, "max iterations reached without completion"
        );
        Ok(AgentOutcome::MaxIterationsReached)
    }

    fn is_completed(&self, agent: &str, workdir: &Path) -> Result<bool> {
        let progress_file = workdir.join(".agent-progress").join(format!("{agent}.md"));
        if !progress_file.is_file() {
            return Ok(false);
        }
        let content = std::fs::read_to_string(&progress_file)?;
        Ok(content.contains("## Status: COMPLETED"))
    }

    fn build_prompt(
        &self,
        agent: &str,
        workdir: &Path,
        prd_path: &Path,
        previous_agents: &[String],
        iteration: u32,
        max_iterations: u32,
    ) -> Result<PathBuf> {
        let root = &self.config.root_dir;
        let mut prompt = String::new();

        // 1. Base system prompt
        let base_path = root.join("agents/_base-system.md");
        if base_path.is_file() {
            prompt.push_str(&std::fs::read_to_string(&base_path)?);
            prompt.push_str("\n\n");
        }

        // 2. Agent-specific prompt
        let agent_prompt_path = root.join(format!("agents/{agent}/prompt.md"));
        if agent_prompt_path.is_file() {
            prompt.push_str(&std::fs::read_to_string(&agent_prompt_path)?);
            prompt.push_str("\n\n");
        }

        // 3. PRD content
        prompt.push_str("---\n\n# PRD\n\n");
        let prd_content = std::fs::read_to_string(prd_path)
            .with_context(|| format!("failed to read PRD: {}", prd_path.display()))?;
        prompt.push_str(&prd_content);
        prompt.push_str("\n\n");

        // 4. Previous agents' context
        if !previous_agents.is_empty() {
            prompt.push_str("---\n\n# Previous Agents' Progress\n\n");
            for prev in previous_agents {
                let progress_file = workdir.join(".agent-progress").join(format!("{prev}.md"));
                if progress_file.is_file() {
                    prompt.push_str(&format!("## {prev}\n\n"));
                    prompt.push_str(&std::fs::read_to_string(&progress_file).unwrap_or_default());
                    prompt.push_str("\n\n");
                }
            }
        }

        // 5. Current agent's own progress (from prior iterations)
        let own_progress = workdir.join(".agent-progress").join(format!("{agent}.md"));
        if own_progress.is_file() {
            prompt.push_str("---\n\n# Your Progress (from previous iterations)\n\n");
            prompt.push_str(&std::fs::read_to_string(&own_progress).unwrap_or_default());
            prompt.push_str("\n\n");
        }

        // 6. Architecture doc (skip for architect)
        if agent != "architect" {
            let prd = crate::prd::Prd::load(prd_path).ok();
            if let Some(prd) = &prd {
                let arch_doc = workdir
                    .join("docs/architecture")
                    .join(prd.slug())
                    .join("architecture.md");
                if arch_doc.is_file() {
                    prompt.push_str("---\n\n# Architecture\n\n");
                    prompt.push_str(&std::fs::read_to_string(&arch_doc).unwrap_or_default());
                    prompt.push_str("\n\n");
                }

                // 7. Design doc (skip for architect and designer)
                if agent != "designer" {
                    let design_doc = workdir
                        .join("docs/architecture")
                        .join(prd.slug())
                        .join("design.md");
                    if design_doc.is_file() {
                        prompt.push_str("---\n\n# Design\n\n");
                        prompt.push_str(&std::fs::read_to_string(&design_doc).unwrap_or_default());
                        prompt.push_str("\n\n");
                    }
                }
            }
        }

        // 8. Project context
        let context_file = workdir.join(self.config.context_filename());
        if context_file.is_file() {
            prompt.push_str("---\n\n# Project Context\n\n");
            prompt.push_str(&std::fs::read_to_string(&context_file).unwrap_or_default());
            prompt.push_str("\n\n");
        }

        // 9. Iteration context
        prompt.push_str("---\n\n# Iteration Context\n\n");
        prompt.push_str(&format!("- Iteration: {iteration} of {max_iterations}\n"));
        prompt.push_str(&format!("- Agent: {agent}\n"));
        prompt.push_str(&format!("- Working directory: {}\n", workdir.display()));
        if iteration == max_iterations {
            prompt.push_str("- **FINAL ITERATION**: You MUST complete all remaining work and mark status as COMPLETED.\n");
        }

        // Write to temp file
        let prompt_path = workdir.join(format!(".pipeline/prompt-{agent}.md"));
        std::fs::create_dir_all(workdir.join(".pipeline"))?;
        std::fs::write(&prompt_path, &prompt)?;

        Ok(prompt_path)
    }

    async fn execute_cli(
        &self,
        agent: &str,
        args: &[String],
        workdir: &Path,
        opts: &RunOpts,
    ) -> Result<i32> {
        use std::process::Stdio;
        use tokio::io::{AsyncBufReadExt, BufReader};

        let cli = self.provider.cli_name();
        let mut cmd = tokio::process::Command::new(cli);
        cmd.args(args)
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn {cli}"))?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let jsonl_path = opts.log_jsonl.clone();
        let formatted_path = opts.log_formatted.clone();

        let provider_kind = self.config.provider;
        let truncate_len = 500usize;

        // Stream stdout: write JSONL + formatted log
        let stdout_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            let mut jsonl_file = jsonl_path
                .as_ref()
                .and_then(|p| std::fs::File::create(p).ok());
            let mut formatted_file = formatted_path
                .as_ref()
                .and_then(|p| std::fs::File::create(p).ok());

            while let Ok(Some(line)) = lines.next_line().await {
                // Write raw JSONL
                if let Some(f) = &mut jsonl_file {
                    use std::io::Write;
                    let _ = writeln!(f, "{line}");
                }

                // Format and write
                if let Some(f) = &mut formatted_file {
                    let cursor = std::io::Cursor::new(format!("{line}\n"));
                    crate::logging::formatter::format_jsonl_stream(
                        std::io::BufReader::new(cursor),
                        f,
                        provider_kind,
                        truncate_len,
                    );
                }
            }
        });

        let agent_name = agent.to_string();
        let stderr_handle = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(agent = %agent_name, stderr = %line);
            }
        });

        let status = child.wait().await?;
        let _ = stdout_handle.await;
        let _ = stderr_handle.await;

        Ok(status.code().unwrap_or(-1))
    }
}

enum InteractiveChoice {
    Continue,
    Skip,
    Abort,
}

fn prompt_interactive(agent: &str, iteration: u32) -> Result<InteractiveChoice> {
    use dialoguer::Select;

    let selection = Select::new()
        .with_prompt(format!(
            "[{agent}] iteration {iteration} complete. What next?"
        ))
        .items(&[
            "Continue to next iteration",
            "Skip this agent",
            "Abort pipeline",
        ])
        .default(0)
        .interact()?;

    Ok(match selection {
        0 => InteractiveChoice::Continue,
        1 => InteractiveChoice::Skip,
        _ => InteractiveChoice::Abort,
    })
}
