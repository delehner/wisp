use std::path::Path;

use anyhow::{bail, Result};
use tracing::{info, warn};

use crate::utils::exec_capture;

/// Represents an active Dev Container with RAII-style cleanup.
pub struct DevContainer {
    container_id: String,
    workspace_folder: String,
    workdir: std::path::PathBuf,
}

impl DevContainer {
    /// Start a Dev Container for the given workspace.
    pub async fn start(workdir: &Path) -> Result<Self> {
        let devcontainer_config = workdir.join(".devcontainer/agent/devcontainer.json");
        if !devcontainer_config.is_file() {
            bail!(
                "Dev Container config not found: {}",
                devcontainer_config.display()
            );
        }

        info!(workdir = %workdir.display(), "starting Dev Container");

        let (code, stdout, stderr) = exec_capture(
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
        .await?;

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

    /// Stop and remove the container.
    pub async fn stop(&self) {
        if self.container_id.is_empty() {
            return;
        }
        info!(container_id = %self.container_id, "stopping Dev Container");
        let _ = exec_capture("docker", &["stop", &self.container_id], None).await;
        let _ = exec_capture("docker", &["rm", &self.container_id], None).await;
    }

    pub fn workspace_folder(&self) -> &str {
        &self.workspace_folder
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
