mod claude;
mod gemini;

use std::path::Path;

use anyhow::Result;

use crate::cli::ProviderKind;
use crate::config::Config;

/// Outcome of a single AI CLI invocation.
#[derive(Debug)]
pub struct RunOutcome {
    pub exit_code: i32,
    pub session_id: Option<String>,
}

/// Options for a provider run.
#[derive(Debug, Clone)]
pub struct RunOpts {
    pub model: String,
    pub allowed_tools: String,
    pub output_format: String,
    pub verbose: bool,
    pub log_jsonl: Option<std::path::PathBuf>,
    pub log_formatted: Option<std::path::PathBuf>,
}

/// Provider-agnostic interface for AI CLI invocations.
pub trait Provider: Send + Sync {
    fn cli_name(&self) -> &str;
    fn context_filename(&self) -> &str;
    fn npm_package(&self) -> &str;

    /// Check if the CLI is installed and accessible.
    fn validate_cli(&self) -> Result<()>;

    /// Build the command arguments for a headless run.
    fn build_run_args(&self, prompt_file: &Path, opts: &RunOpts) -> Vec<String>;

    /// Extract a session ID from JSONL output lines.
    fn extract_session_id(&self, lines: &[String]) -> Option<String>;

    /// Return a human-readable resume hint for a session.
    fn resume_hint(&self, session_id: &str) -> String {
        format!("{} --resume {}", self.cli_name(), session_id)
    }

    /// Return the auth-check command (for dev container validation).
    fn auth_check_cmd(&self) -> String {
        format!("{} auth status", self.cli_name())
    }
}

/// Create a boxed provider from the config.
pub fn create_provider(config: &Config) -> Box<dyn Provider> {
    match config.provider {
        ProviderKind::Claude => Box::new(claude::ClaudeProvider::new(config)),
        ProviderKind::Gemini => Box::new(gemini::GeminiProvider::new(config)),
    }
}
