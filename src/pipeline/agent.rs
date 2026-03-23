use std::io::{Read, Seek};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::cli::ProviderKind;
use crate::config::Config;
use crate::pipeline::devcontainer::{rewrite_workspace_paths_for_container, DevContainer};
use crate::provider::{Provider, RunOpts};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentOutcome {
    Completed,
    MaxIterationsReached,
    Skipped,
    Failed(String),
}

/// Arguments for [`AgentRunner::run`].
pub struct AgentRunParams<'a> {
    pub workdir: &'a Path,
    pub prd_path: &'a Path,
    pub previous_agents: &'a [String],
    pub configured_max: u32,
    pub interactive: bool,
    pub log_dir: &'a Path,
    /// When set, the provider CLI runs via `devcontainer exec` in this container.
    pub dev_container: Option<&'a DevContainer>,
}

struct IterationMeta {
    iteration: u32,
    configured_limit: u32,
    hard_cap: u32,
}

/// Path the provider CLI must use for Write/Edit/Bash inside a Dev Container (`remoteWorkspaceFolder`).
/// Falls back to the host checkout path when not containerized.
fn agent_repo_root_display(dev_container: Option<&DevContainer>, workdir: &Path) -> String {
    dev_container
        .map(|dc| dc.workspace_folder().to_string())
        .unwrap_or_else(|| workdir.display().to_string())
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
    ///
    /// `params.configured_max` is the manifest/config budget (shown to the model). **Blocking**
    /// agents may continue past that up to [`hard_iteration_cap`] so they can reach
    /// `## Status: COMPLETED` instead of failing early. Logs go under `params.log_dir`.
    pub async fn run(&self, agent: &str, params: AgentRunParams<'_>) -> Result<AgentOutcome> {
        let AgentRunParams {
            workdir,
            prd_path,
            previous_agents,
            configured_max,
            interactive,
            log_dir,
            dev_container,
        } = params;

        let progress_dir = workdir.join(".agent-progress");
        std::fs::create_dir_all(&progress_dir)?;

        std::fs::create_dir_all(log_dir)?;

        let configured_max = configured_max.max(1);
        let hard_cap = hard_iteration_cap(agent, configured_max);
        if hard_cap > configured_max {
            info!(
                agent,
                configured_max,
                hard_cap,
                "blocking agent: iteration hard cap extended past configured max"
            );
        }

        let mut stall_streak = 0u32;
        let agent_repo_root = agent_repo_root_display(dev_container, workdir);

        for iteration in 1..=hard_cap {
            if self.is_completed(agent, workdir)? {
                info!(agent, "already completed");
                return Ok(AgentOutcome::Completed);
            }
            if self.is_blocked(agent, workdir)? {
                warn!(agent, iteration, "agent progress is BLOCKED");
                return Ok(AgentOutcome::Failed(
                    "progress file has ## Status: BLOCKED".into(),
                ));
            }

            let snapshot_before = Self::read_progress_snapshot(agent, workdir);

            if iteration > configured_max {
                info!(
                    agent,
                    iteration,
                    hard_cap,
                    "extension iteration (past configured max — must reach COMPLETED)"
                );
            } else {
                info!(agent, iteration, configured_max, "starting iteration");
            }

            let resume_session = if iteration > 1 {
                let prev_session =
                    log_dir.join(format!("{agent}_iteration_{}.session", iteration - 1));
                std::fs::read_to_string(&prev_session)
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            };

            let meta = IterationMeta {
                iteration,
                configured_limit: configured_max,
                hard_cap,
            };

            let pipeline_dir = workdir.join(".pipeline");
            std::fs::create_dir_all(&pipeline_dir)?;

            let (prompt_file_opt, prompt_inline): (Option<PathBuf>, Option<String>) = if let Some(
                ref sid,
            ) =
                resume_session
            {
                info!(
                    agent,
                    iteration,
                    session = %sid,
                    "resuming provider session (Ralph iteration > 1)"
                );
                let text = self.continuation_prompt_text(agent, workdir, meta, &agent_repo_root)?;
                (None, Some(text))
            } else {
                if iteration > 1 {
                    warn!(
                            agent,
                            iteration,
                            "missing prior .session file — cold-starting with full prompt (no --resume)"
                        );
                }
                let p = self.build_prompt(
                    agent,
                    workdir,
                    prd_path,
                    previous_agents,
                    meta,
                    &agent_repo_root,
                )?;
                (Some(p), None)
            };

            let path_for_cli: &Path = match &prompt_file_opt {
                Some(p) => p.as_path(),
                None => pipeline_dir.as_path(),
            };

            let model = self.config.model_for_agent(agent);
            let opts = RunOpts {
                model,
                allowed_tools: self.config.claude_allowed_tools.clone(),
                output_format: "stream-json".into(),
                verbose: self.config.verbose_logs,
                log_jsonl: Some(log_dir.join(format!("{agent}_iteration_{iteration}.jsonl"))),
                log_formatted: Some(log_dir.join(format!("{agent}_iteration_{iteration}.log"))),
                resume_session_id: resume_session.clone(),
                prompt_inline,
            };

            let args = self.provider.build_run_args(path_for_cli, &opts);
            let (exit_code, stderr_lines) = self
                .execute_cli(agent, &args, workdir, &opts, dev_container)
                .await?;

            if let Some(ref p) = prompt_file_opt {
                let _ = std::fs::remove_file(p);
            }

            let stderr_path = log_dir.join(format!("{agent}_iteration_{iteration}.stderr.log"));
            if !stderr_lines.is_empty() {
                let _ = std::fs::write(&stderr_path, stderr_lines.join("\n"));
            }

            // Persist session id for the next iteration's `--resume`
            if let Some(jsonl_path) = &opts.log_jsonl {
                if jsonl_path.is_file() {
                    let lines: Vec<String> = std::fs::read_to_string(jsonl_path)
                        .unwrap_or_default()
                        .lines()
                        .map(|l| l.to_string())
                        .collect();
                    let mut session_id = self.provider.extract_session_id(&lines);
                    if session_id.is_none() {
                        session_id = resume_session.clone();
                    }
                    if let Some(session_id) = session_id {
                        let session_file =
                            log_dir.join(format!("{agent}_iteration_{iteration}.session"));
                        let _ = std::fs::write(&session_file, &session_id);
                    } else {
                        warn!(
                            agent,
                            iteration,
                            "could not extract session_id from JSONL — next iteration may cold-start"
                        );
                    }
                }
            }

            let mut jsonl_hints: Vec<String> = Vec::new();
            if exit_code != 0 {
                warn!(agent, exit_code, iteration, "CLI exited with non-zero code");
                if !stderr_lines.is_empty() {
                    let stderr_preview: String = stderr_lines.join("\n");
                    let truncated = if stderr_preview.len() > 2000 {
                        format!("{}... (truncated)", &stderr_preview[..2000])
                    } else {
                        stderr_preview
                    };
                    warn!(agent, stderr = %truncated, "CLI stderr");
                }
                if let Some(ref jsonl_path) = opts.log_jsonl {
                    if jsonl_path.is_file() {
                        warn!(agent, path = %jsonl_path.display(), "CLI JSONL log");
                        if let Some((tail_preview, hints)) =
                            diagnose_failed_jsonl_log(jsonl_path, self.config.provider)
                        {
                            warn!(
                                agent,
                                lines = %tail_preview,
                                "CLI JSONL tail (last non-empty lines, truncated per line)"
                            );
                            for hint in &hints {
                                warn!(agent, hint = %hint, "CLI JSONL error hint");
                            }
                            jsonl_hints = hints;
                        }
                    } else {
                        warn!(
                            agent,
                            path = %jsonl_path.display(),
                            "CLI JSONL path missing or empty — provider may have failed before writing"
                        );
                    }
                }
                if matches!(self.config.provider, ProviderKind::Claude) {
                    if let Some(msg) = claude_container_auth_fatal_message(&jsonl_hints) {
                        return Ok(AgentOutcome::Failed(msg));
                    }
                    if let Some(msg) = claude_rate_limit_fatal_message(&jsonl_hints) {
                        return Ok(AgentOutcome::Failed(msg));
                    }
                }
            }

            if self.is_completed(agent, workdir)? {
                info!(agent, iteration, "completed");
                return Ok(AgentOutcome::Completed);
            }

            let snapshot_after = Self::read_progress_snapshot(agent, workdir);
            if snapshot_after == snapshot_before {
                stall_streak += 1;
                warn!(
                    agent,
                    iteration,
                    stall_streak,
                    MAX_STALL_STREAK,
                    "progress file unchanged this iteration"
                );
                if stall_streak >= MAX_STALL_STREAK {
                    return Ok(AgentOutcome::Failed(format!(
                        "Ralph stall: `.agent-progress/{agent}.md` did not change for {stall_streak} consecutive iterations — update that file and set `## Status: COMPLETED` (or `## Status: BLOCKED`). \
                         If you only used Read on `.pipeline/` prompt files, use Write/Edit on the repo and progress file instead."
                    )));
                }
            } else {
                stall_streak = 0;
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

            if iteration < hard_cap {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }

        warn!(
            agent,
            hard_cap,
            configured_max,
            "max iterations reached without completion (hard cap exhausted)"
        );
        Ok(AgentOutcome::MaxIterationsReached)
    }

    fn read_progress_snapshot(agent: &str, workdir: &Path) -> String {
        let progress_file = workdir.join(".agent-progress").join(format!("{agent}.md"));
        std::fs::read_to_string(&progress_file)
            .unwrap_or_default()
            .replace('\r', "")
            .trim()
            .to_string()
    }

    fn is_completed(&self, agent: &str, workdir: &Path) -> Result<bool> {
        Ok(progress_status_completed(&Self::read_progress_snapshot(
            agent, workdir,
        )))
    }

    fn is_blocked(&self, agent: &str, workdir: &Path) -> Result<bool> {
        let progress_file = workdir.join(".agent-progress").join(format!("{agent}.md"));
        if !progress_file.is_file() {
            return Ok(false);
        }
        let content = std::fs::read_to_string(&progress_file)?;
        Ok(progress_status_blocked(&content))
    }

    fn build_prompt(
        &self,
        agent: &str,
        workdir: &Path,
        prd_path: &Path,
        previous_agents: &[String],
        meta: IterationMeta,
        agent_repo_root: &str,
    ) -> Result<PathBuf> {
        let IterationMeta {
            iteration,
            configured_limit,
            hard_cap,
        } = meta;
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
        prompt.push_str(&format!("- Configured iteration budget: {configured_limit} (shown to you as the nominal plan)\n"));
        prompt.push_str(&format!(
            "- This run: iteration {iteration} of up to {hard_cap} for this agent\n"
        ));
        prompt.push_str(&format!("- Agent: {agent}\n"));
        prompt.push_str(&format!(
            "- Repository root (use this for all Write/Edit/Bash absolute paths): {agent_repo_root}\n"
        ));
        let host_root = workdir.display().to_string();
        if host_root != agent_repo_root {
            prompt.push_str(&format!(
                "- Pipeline host checkout (not visible as the same path inside the Dev Container — do not use for file tools): {host_root}\n"
            ));
        }
        if iteration > configured_limit {
            prompt.push_str(
                "- **Extension phase**: The configured iteration budget is exhausted but the pipeline is still waiting for `## Status: COMPLETED` in your progress file. Finish the remaining checklist items now, or set `## Status: BLOCKED` with concrete blockers.\n",
            );
        }
        if iteration == hard_cap {
            prompt.push_str(
                "- **FINAL HARD-STOP ITERATION**: No further runs after this. You MUST set `## Status: COMPLETED` if work is done, or `## Status: BLOCKED` with explicit blockers.\n",
            );
        }

        // Write to temp file
        let prompt_path = workdir.join(format!(".pipeline/prompt-{agent}.md"));
        std::fs::create_dir_all(workdir.join(".pipeline"))?;
        std::fs::write(&prompt_path, &prompt)?;

        Ok(prompt_path)
    }

    /// Short **inline** `-p` text for iteration 2+ (`--resume`). Must not be a filesystem path or the
    /// model tends to `Read` it and stop without updating `.agent-progress/`.
    fn continuation_prompt_text(
        &self,
        agent: &str,
        workdir: &Path,
        meta: IterationMeta,
        agent_repo_root: &str,
    ) -> Result<String> {
        let IterationMeta {
            iteration,
            configured_limit,
            hard_cap,
        } = meta;
        let progress_rel = format!(".agent-progress/{agent}.md");
        let cli = self.provider.cli_name();

        let mut body = String::new();
        body.push_str("# Ralph loop — continue this session\n\n");
        body.push_str(
            "This message is your **entire** `-p` input (inline text, not a file path). **Do not** use Read on any `.pipeline/prompt*` file — there is nothing useful to read there.\n\n",
        );
        body.push_str(&format!(
            "The `{cli}` CLI is running with `--resume`; you already have the PRD, agent instructions, and project context in this session.\n\n",
        ));
        body.push_str("## Required actions\n\n");
        body.push_str(&format!(
            "1. Open `{progress_rel}` with Read, then **Write** or **Edit** it: real checkboxes, files touched, and when done set a line exactly: `## Status: COMPLETED`.\n",
        ));
        body.push_str(&format!(
            "2. Use **Write**, **Edit**, **MultiEdit**, or **Bash** on real repo paths under `{}` — produce the artifacts your agent role requires.\n",
            agent_repo_root
        ));
        let host_root = workdir.display().to_string();
        if host_root != agent_repo_root {
            body.push_str(&format!(
                "   Do not use the host checkout path `{}` inside the container — it is not the bind-mounted workspace.\n",
                host_root
            ));
        }
        body.push_str("3. If impossible, set `## Status: BLOCKED` with explicit blockers.\n\n");
        body.push_str("## Iteration budget\n\n");
        body.push_str(&format!(
            "- Nominal budget: **{configured_limit}**; this is iteration **{iteration}** (hard cap **{hard_cap}**).\n",
        ));
        if iteration > configured_limit {
            body.push_str("- **Extension phase** — finish or BLOCK.\n");
        }
        if iteration == hard_cap {
            body.push_str("- **Final iteration** — COMPLETED or BLOCKED only.\n");
        }

        Ok(body)
    }

    async fn execute_cli(
        &self,
        agent: &str,
        args: &[String],
        workdir: &Path,
        opts: &RunOpts,
        dev_container: Option<&DevContainer>,
    ) -> Result<(i32, Vec<String>)> {
        use std::process::Stdio;
        use tokio::io::{AsyncBufReadExt, BufReader};

        let cli = self.provider.cli_name();

        if let Some(dc) = dev_container {
            let inner_args =
                rewrite_workspace_paths_for_container(args, workdir, dc.workspace_folder());
            return dc
                .exec_provider_streaming(
                    cli,
                    &inner_args,
                    self.config.provider,
                    opts.log_jsonl.clone(),
                    opts.log_formatted.clone(),
                )
                .await
                .with_context(|| format!("devcontainer exec failed for {cli}"));
        }

        let mut cmd = tokio::process::Command::new(cli);
        cmd.args(args)
            .current_dir(workdir)
            .stdin(Stdio::null())
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
            let mut collected = Vec::new();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(agent = %agent_name, stderr = %line);
                collected.push(line);
            }
            collected
        });

        let status = child.wait().await?;
        let _ = stdout_handle.await;
        let stderr_lines = stderr_handle.await.unwrap_or_default();

        Ok((status.code().unwrap_or(-1), stderr_lines))
    }
}

/// Abort after this many iterations in a row with no edit to `.agent-progress/{agent}.md`.
const MAX_STALL_STREAK: u32 = 2;

/// Last bytes read from JSONL when summarizing a failed CLI run (UTF-8 safe cut).
const JSONL_DIAG_TAIL_BYTES: usize = 16 * 1024;
/// How many non-empty lines from the tail to log.
const JSONL_DIAG_TAIL_LINES: usize = 15;
/// Max characters per logged line (rest replaced with "…").
const JSONL_DIAG_LINE_CAP: usize = 450;

fn read_utf8_tail(path: &Path, max_bytes: usize) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len() as usize;
    if len <= max_bytes {
        let mut s = String::new();
        file.read_to_string(&mut s).ok()?;
        return Some(s);
    }
    let start = len.saturating_sub(max_bytes);
    file.seek(std::io::SeekFrom::Start(start as u64)).ok()?;
    let mut buf = vec![0u8; len - start];
    file.read_exact(&mut buf).ok()?;
    let mut cut = 0usize;
    while cut < buf.len() && (buf[cut] & 0b1100_0000) == 0b1000_0000 {
        cut += 1;
    }
    String::from_utf8(buf[cut..].to_vec()).ok()
}

fn truncate_jsonl_line(line: &str, max_chars: usize) -> String {
    let n = line.chars().count();
    if n <= max_chars {
        line.to_string()
    } else {
        let trunc: String = line.chars().take(max_chars).collect();
        format!("{trunc}… ({n} chars total)")
    }
}

fn extract_jsonl_error_hints(lines: &[String], provider: ProviderKind) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match provider {
            ProviderKind::Claude => {
                if v.get("type").and_then(|t| t.as_str()) == Some("error") {
                    out.push(truncate_jsonl_line(&v.to_string(), 500));
                    continue;
                }
                if v.get("type").and_then(|t| t.as_str()) == Some("result")
                    && v.get("is_error").and_then(|b| b.as_bool()) == Some(true)
                {
                    if let Some(r) = v.get("result").and_then(|x| x.as_str()) {
                        if !r.is_empty() {
                            out.push(format!("result: {}", truncate_jsonl_line(r, 400)));
                        }
                    }
                    continue;
                }
                if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    if !msg.is_empty() {
                        out.push(format!("message: {}", truncate_jsonl_line(msg, 400)));
                    }
                }
                if let Some(e) = v.get("error") {
                    let s = e.to_string();
                    if !s.is_empty() && s != "null" {
                        out.push(format!("error: {}", truncate_jsonl_line(&s, 400)));
                    }
                }
            }
            ProviderKind::Gemini => {
                if let Some(msg) = v
                    .get("errorMessage")
                    .or_else(|| v.get("message"))
                    .and_then(|m| m.as_str())
                {
                    if !msg.is_empty() {
                        out.push(format!("message: {}", truncate_jsonl_line(msg, 400)));
                    }
                }
                if let Some(e) = v.get("error") {
                    let s = e.to_string();
                    if !s.is_empty() && s != "null" {
                        out.push(format!("error: {}", truncate_jsonl_line(&s, 400)));
                    }
                }
            }
        }
        if out.len() >= 5 {
            break;
        }
    }
    out
}

/// Build tail preview and loose error hints for tracing when the provider exits non-zero.
fn diagnose_failed_jsonl_log(path: &Path, provider: ProviderKind) -> Option<(String, Vec<String>)> {
    let content = read_utf8_tail(path, JSONL_DIAG_TAIL_BYTES)?;
    let mut nonempty: Vec<String> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
        .collect();
    let n = nonempty.len();
    if n == 0 {
        return None;
    }
    let start = n.saturating_sub(JSONL_DIAG_TAIL_LINES);
    let tail_raw: Vec<String> = nonempty.drain(start..).collect();
    let hints = extract_jsonl_error_hints(&tail_raw, provider);
    let preview = tail_raw
        .iter()
        .map(|l| truncate_jsonl_line(l, JSONL_DIAG_LINE_CAP))
        .collect::<Vec<_>>()
        .join("\n");
    Some((preview, hints))
}

/// When Claude JSONL reports a hard auth failure, return an actionable pipeline error.
fn claude_container_auth_fatal_message(hints: &[String]) -> Option<String> {
    let blob = hints.join(" ").to_lowercase();
    if !blob.contains("not logged in")
        && !blob.contains("please run /login")
        && !blob.contains("run /login")
    {
        return None;
    }
    Some(
        "Claude Code is not authenticated in the agent container (JSONL: not logged in). \
         Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the .env file Wisp loads \
         (repository root next to agents/ when running from source, or ~/.wisp/.env for installs), \
         or run `claude setup-token` for subscription accounts and put the token in .env. \
         The shell that launches `wisp` must expose those variables so `devcontainer` can resolve \
         ${localEnv:...} in .devcontainer/agent/devcontainer.json. \
         If the container was created when keys were missing, remove it or run a fresh devcontainer up \
         so containerEnv picks up current values. See docs/prerequisites.md (Authentication, Dev Containers)."
            .to_string(),
    )
}

/// When Claude JSONL reports quota / rate limit exhaustion, fail fast (not a Ralph stall).
fn claude_rate_limit_fatal_message(hints: &[String]) -> Option<String> {
    let blob = hints.join(" ").to_lowercase();
    let is_limited = blob.contains("rate_limit")
        || blob.contains("rate limit")
        || blob.contains("hit your limit")
        || blob.contains("usage limit")
        || blob.contains("quota exceeded");
    if !is_limited {
        return None;
    }
    Some(
        "Claude API usage or rate limit reached (JSONL: rate_limit / quota). \
         Wait until the limit resets (see the provider message for time), reduce parallel epics, \
         upgrade your plan, or switch API key / account. \
         This is not a Ralph stall — the agent could not run because of provider limits."
            .to_string(),
    )
}

fn progress_status_completed(snapshot: &str) -> bool {
    for line in snapshot.lines() {
        let t = line.trim();
        if !t.starts_with("##") {
            continue;
        }
        let u = t.to_ascii_uppercase();
        if u.contains("STATUS") && u.contains("COMPLETED") && !u.contains("IN_PROGRESS") {
            return true;
        }
    }
    false
}

fn progress_status_blocked(content: &str) -> bool {
    for line in content.lines() {
        let t = line.trim();
        if !t.starts_with("##") {
            continue;
        }
        let u = t.to_ascii_uppercase();
        if u.contains("STATUS") && u.contains("BLOCKED") {
            return true;
        }
    }
    false
}

/// Extra iterations for **blocking** agents beyond the manifest/config `max_iterations`.
/// Caps token spend while reducing false "max iterations" failures on large PRDs.
fn hard_iteration_cap(agent: &str, configured_max: u32) -> u32 {
    let configured_max = configured_max.max(1);
    if crate::pipeline::is_blocking(agent) {
        let scaled = configured_max.saturating_mul(4);
        scaled.clamp(24, 128)
    } else {
        configured_max
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

#[cfg(test)]
mod tests {
    use crate::cli::ProviderKind;

    use super::{
        claude_container_auth_fatal_message, claude_rate_limit_fatal_message,
        diagnose_failed_jsonl_log, extract_jsonl_error_hints, progress_status_blocked,
        progress_status_completed, read_utf8_tail,
    };

    #[test]
    fn completed_detects_standard_line() {
        assert!(progress_status_completed("## Status: COMPLETED\n"));
    }

    #[test]
    fn completed_rejects_in_progress() {
        assert!(!progress_status_completed("## Status: IN_PROGRESS\n"));
    }

    #[test]
    fn blocked_detects_status_line() {
        assert!(progress_status_blocked("## Status: BLOCKED\n"));
    }

    #[test]
    fn read_utf8_tail_reads_small_file_whole() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.jsonl");
        std::fs::write(&p, "line1\nline2\n").unwrap();
        let s = read_utf8_tail(&p, 1024).unwrap();
        assert!(s.contains("line1"));
        assert!(s.contains("line2"));
    }

    #[test]
    fn diagnose_failed_jsonl_log_claude_error_type() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("run.jsonl");
        std::fs::write(
            &p,
            "{\"type\":\"init\",\"session_id\":\"x\"}\n{\"type\":\"error\",\"message\":\"bad\"}\n",
        )
        .unwrap();
        let (tail, hints) = diagnose_failed_jsonl_log(&p, ProviderKind::Claude).unwrap();
        assert!(tail.contains("error"));
        assert!(!hints.is_empty());
    }

    #[test]
    fn extract_hints_claude_result_is_error() {
        let line = r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","session_id":"x"}"#
            .to_string();
        let hints = extract_jsonl_error_hints(&[line], ProviderKind::Claude);
        assert!(hints.iter().any(|h| h.contains("Not logged in")));
    }

    #[test]
    fn claude_auth_fatal_message_from_hints() {
        let hints = vec!["result: Not logged in · Please run /login".to_string()];
        let msg = claude_container_auth_fatal_message(&hints).unwrap();
        assert!(msg.contains("ANTHROPIC_API_KEY"));
        assert!(msg.contains("prerequisites"));
    }

    #[test]
    fn claude_rate_limit_fatal_message_from_hints() {
        let hints = vec![
            r#"error: "rate_limit""#.to_string(),
            "result: You've hit your limit · resets 6pm (UTC)".to_string(),
        ];
        let msg = claude_rate_limit_fatal_message(&hints).unwrap();
        assert!(msg.contains("rate limit"));
        assert!(msg.contains("Ralph stall"));
    }
}
