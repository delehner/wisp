use std::path::Path;
use std::process::Stdio;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Run a command, streaming stdout/stderr to the provided writers.
/// Returns the exit code.
pub async fn exec_streaming(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    env_vars: &[(&str, &str)],
    on_stdout: impl Fn(&str) + Send + 'static,
    on_stderr: impl Fn(&str) + Send + 'static,
) -> Result<i32> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    let mut child = cmd
        .spawn()
        .with_context(|| format!("failed to spawn {program}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_stdout(&line);
        }
    });

    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_stderr(&line);
        }
    });

    let status = child.wait().await.context("failed to wait for child")?;
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    Ok(status.code().unwrap_or(-1))
}

/// Run a command and capture its output.
pub async fn exec_capture(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<(i32, String, String)> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd
        .output()
        .await
        .with_context(|| format!("failed to run {program}"))?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok((code, stdout, stderr))
}

/// Check if a command is available in PATH.
pub fn command_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Extract the repo name from a URL like https://github.com/org/repo.git
pub fn repo_name_from_url(url: &str) -> String {
    let name = url
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .rsplit('/')
        .next()
        .unwrap_or("repo");
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_repo_name() {
        assert_eq!(
            repo_name_from_url("https://github.com/org/my-repo.git"),
            "my-repo"
        );
        assert_eq!(
            repo_name_from_url("https://github.com/org/my-repo"),
            "my-repo"
        );
        assert_eq!(
            repo_name_from_url("git@github.com:org/my-repo.git"),
            "my-repo"
        );
    }
}
