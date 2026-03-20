use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};

use anyhow::{bail, Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::cli::ProviderKind;
use crate::utils::exec_capture;

fn agent_devcontainer_config(workdir: &Path) -> PathBuf {
    workdir.join(".devcontainer/agent/devcontainer.json")
}

/// One `devcontainer up` at a time per Wisp process. Parallel `up` calls (e.g. multiple epics) race
/// when fetching the same OCI features into the CLI cache, which can yield `TAR_BAD_ARCHIVE` /
/// "Failed to download package" for `ghcr.io/devcontainers/features/*`.
static DEVCONTAINER_UP_LOCK: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn devcontainer_up_semaphore() -> Arc<Semaphore> {
    DEVCONTAINER_UP_LOCK
        .get_or_init(|| Arc::new(Semaphore::new(1)))
        .clone()
}

/// Represents an active Dev Container with RAII-style cleanup.
pub struct DevContainer {
    container_id: String,
    workspace_folder: String,
    workdir: PathBuf,
    config_path: PathBuf,
}

impl DevContainer {
    /// Start a Dev Container for the given workspace.
    pub async fn start(workdir: &Path) -> Result<Self> {
        let devcontainer_config = agent_devcontainer_config(workdir);
        if !devcontainer_config.is_file() {
            bail!(
                "Dev Container config not found: {}",
                devcontainer_config.display()
            );
        }

        info!(workdir = %workdir.display(), "starting Dev Container");

        let up_sem = devcontainer_up_semaphore();
        let (code, stdout, stderr) = {
            let _up_slot = up_sem
                .acquire()
                .await
                .context("devcontainer up coordination semaphore closed")?;
            exec_capture(
                "devcontainer",
                &[
                    "up",
                    "--workspace-folder",
                    workdir.to_str().unwrap_or("."),
                    "--config",
                    devcontainer_config.to_str().unwrap_or(""),
                ],
                None,
            )
            .await?
        };

        if code != 0 {
            bail!("devcontainer up failed: {stderr}");
        }

        // Parse the last JSON line for containerId and remoteWorkspaceFolder
        let json_line = stdout
            .lines()
            .rev()
            .find(|l| l.trim_start().starts_with('{'))
            .unwrap_or("{}");

        let parsed: serde_json::Value =
            serde_json::from_str(json_line).unwrap_or(serde_json::Value::Null);

        let container_id = parsed
            .get("containerId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let repo_name = workdir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace");

        let workspace_folder = parsed
            .get("remoteWorkspaceFolder")
            .and_then(|v| v.as_str())
            .unwrap_or(&format!("/workspaces/{repo_name}"))
            .to_string();

        if container_id.is_empty() {
            bail!("devcontainer up did not return a containerId");
        }

        info!(container_id = %container_id, workspace = %workspace_folder, "Dev Container started");

        Ok(Self {
            container_id,
            workspace_folder,
            workdir: workdir.to_path_buf(),
            config_path: devcontainer_config,
        })
    }

    /// Execute a command inside the Dev Container.
    pub async fn exec(
        &self,
        args: &[&str],
        env_vars: &[(&str, &str)],
    ) -> Result<(i32, String, String)> {
        let mut cmd_args = vec![
            "exec",
            "--workspace-folder",
            self.workdir.to_str().unwrap_or("."),
            "--config",
            self.config_path.to_str().unwrap_or(""),
        ];

        for (k, v) in env_vars {
            cmd_args.push("--remote-env");
            let env_str = format!("{k}={v}");
            // Leak is safe here — these are short-lived process args
            cmd_args.push(Box::leak(env_str.into_boxed_str()));
        }

        cmd_args.extend_from_slice(args);

        exec_capture("devcontainer", &cmd_args, None).await
    }

    /// Run `provider_cli` inside this container with streaming stdout (JSONL + formatted logs).
    /// `provider_args` must use **container** paths (see [`rewrite_workspace_paths_for_container`]).
    pub async fn exec_provider_streaming(
        &self,
        provider_cli: &str,
        provider_args: &[String],
        provider_kind: ProviderKind,
        jsonl_path: Option<PathBuf>,
        formatted_path: Option<PathBuf>,
    ) -> Result<(i32, Vec<String>)> {
        let wf = self.workdir.to_str().unwrap_or(".");

        let mut cmd = Command::new("devcontainer");
        cmd.arg("exec")
            .arg("--workspace-folder")
            .arg(wf)
            .arg("--config")
            .arg(&self.config_path)
            .arg("--")
            .arg(provider_cli);
        for a in provider_args {
            cmd.arg(a);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .with_context(|| "failed to spawn devcontainer exec")?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let stdout_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            let mut jsonl_file = jsonl_path
                .as_ref()
                .and_then(|p| std::fs::File::create(p).ok());
            let mut formatted_file = formatted_path
                .as_ref()
                .and_then(|p| std::fs::File::create(p).ok());

            let truncate_len = 500usize;
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(f) = &mut jsonl_file {
                    use std::io::Write;
                    let _ = writeln!(f, "{line}");
                }
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

        let stderr_handle = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            let mut collected = Vec::new();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(stderr = %line, "devcontainer exec");
                collected.push(line);
            }
            collected
        });

        let status = child.wait().await?;
        let _ = stdout_handle.await;
        let stderr_lines = stderr_handle.await.unwrap_or_default();

        Ok((status.code().unwrap_or(-1), stderr_lines))
    }

    /// Stop and remove the container.
    pub async fn stop(&mut self) {
        if self.container_id.is_empty() {
            return;
        }
        info!(container_id = %self.container_id, "stopping Dev Container");
        let _ = exec_capture("docker", &["stop", &self.container_id], None).await;
        let _ = exec_capture("docker", &["rm", &self.container_id], None).await;
        self.container_id.clear();
    }

    pub fn workspace_folder(&self) -> &str {
        &self.workspace_folder
    }
}

/// Rewrite absolute paths under the host workspace so the CLI inside the container can open them.
pub fn rewrite_workspace_paths_for_container(
    args: &[String],
    host_workdir: &Path,
    remote_workspace: &str,
) -> Vec<String> {
    args.iter()
        .map(|a| rewrite_one_path_arg(a, host_workdir, remote_workspace))
        .collect()
}

fn rewrite_one_path_arg(arg: &str, host_workdir: &Path, remote_workspace: &str) -> String {
    let p = Path::new(arg);
    if let Ok(rel) = p.strip_prefix(host_workdir) {
        let rel = rel.to_string_lossy().replace('\\', "/");
        let rel = rel.trim_start_matches('/');
        format!("{}/{}", remote_workspace.trim_end_matches('/'), rel)
    } else {
        arg.to_string()
    }
}

impl Drop for DevContainer {
    fn drop(&mut self) {
        if !self.container_id.is_empty() {
            warn!(
                "DevContainer dropped without explicit stop — container {} may be orphaned",
                self.container_id
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_paths_strips_host_prefix() {
        let host = Path::new("/tmp/work/wisp");
        let args = vec![
            "-p".into(),
            "/tmp/work/wisp/.pipeline/prompt.md".into(),
            "--model".into(),
            "sonnet".into(),
        ];
        let out = rewrite_workspace_paths_for_container(&args, host, "/workspaces/wisp");
        assert_eq!(out[0], "-p");
        assert_eq!(out[1], "/workspaces/wisp/.pipeline/prompt.md");
        assert_eq!(out[2], "--model");
        assert_eq!(out[3], "sonnet");
    }
}
