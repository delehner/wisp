use std::path::Path;

use anyhow::{bail, Result};

use crate::config::Config;

use super::{Provider, RunOpts};

pub struct GeminiProvider {
    _model: String,
}

impl GeminiProvider {
    pub fn new(config: &Config) -> Self {
        Self {
            _model: config.gemini_model.clone(),
        }
    }
}

impl Provider for GeminiProvider {
    fn cli_name(&self) -> &str {
        "gemini"
    }

    fn context_filename(&self) -> &str {
        "GEMINI.md"
    }

    fn npm_package(&self) -> &str {
        "@google/gemini-cli@latest"
    }

    fn validate_cli(&self) -> Result<()> {
        if which::which("gemini").is_err() {
            bail!(
                "gemini CLI is not installed. Install with: npm install -g {}",
                self.npm_package()
            );
        }
        Ok(())
    }

    fn build_run_args(&self, prompt_file: &Path, opts: &RunOpts) -> Vec<String> {
        let prompt_content = std::fs::read_to_string(prompt_file).unwrap_or_default();

        vec![
            "-p".into(),
            prompt_content,
            "--model".into(),
            opts.model.clone(),
            "--yolo".into(),
            "--output-format".into(),
            opts.output_format.clone(),
        ]
    }

    fn extract_session_id(&self, lines: &[String]) -> Option<String> {
        for line in lines.iter().take(10) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                let id = v
                    .get("sessionId")
                    .or_else(|| v.get("session_id"))
                    .and_then(|v| v.as_str());
                if let Some(id) = id {
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
        }
        None
    }
}
