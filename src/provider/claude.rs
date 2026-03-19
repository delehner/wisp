use std::path::Path;

use anyhow::{bail, Result};

use crate::config::Config;

use super::{Provider, RunOpts};

pub struct ClaudeProvider {
    model: String,
    allowed_tools: String,
}

impl ClaudeProvider {
    pub fn new(config: &Config) -> Self {
        Self {
            model: config.claude_model.clone(),
            allowed_tools: config.claude_allowed_tools.clone(),
        }
    }
}

impl Provider for ClaudeProvider {
    fn cli_name(&self) -> &str {
        "claude"
    }

    fn context_filename(&self) -> &str {
        "CLAUDE.md"
    }

    fn npm_package(&self) -> &str {
        "@anthropic-ai/claude-code@latest"
    }

    fn validate_cli(&self) -> Result<()> {
        if which::which("claude").is_err() {
            bail!(
                "claude CLI is not installed. Install with: npm install -g {}",
                self.npm_package()
            );
        }
        Ok(())
    }

    fn build_run_args(&self, prompt_file: &Path, opts: &RunOpts) -> Vec<String> {
        let prompt_content = std::fs::read_to_string(prompt_file).unwrap_or_default();

        let mut args = vec![
            "-p".into(),
            prompt_content,
            "--model".into(),
            opts.model.clone(),
            "--dangerously-skip-permissions".into(),
            "--output-format".into(),
            opts.output_format.clone(),
        ];

        let tools = if opts.allowed_tools.is_empty() {
            &self.allowed_tools
        } else {
            &opts.allowed_tools
        };
        if !tools.is_empty() {
            args.push("--allowedTools".into());
            args.push(tools.clone());
        }

        if opts.verbose {
            args.push("--verbose".into());
        }

        args
    }

    fn extract_session_id(&self, lines: &[String]) -> Option<String> {
        for line in lines.iter().take(5) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(id) = v.get("session_id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
        }
        None
    }
}
