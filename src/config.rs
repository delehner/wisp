use std::path::{Path, PathBuf};

use crate::cli::ProviderKind;

/// Resolved pipeline configuration from .env + CLI flags + env vars.
#[derive(Debug, Clone)]
pub struct Config {
    pub provider: ProviderKind,
    pub log_dir: PathBuf,
    pub log_level: String,
    pub verbose_logs: bool,
    pub interactive: bool,
    pub work_dir: PathBuf,
    pub max_iterations: u32,
    pub max_parallel: usize,
    pub default_base_branch: String,
    pub use_devcontainer: bool,
    pub update_project_context: bool,
    pub cleanup: bool,
    pub evidence_agents: Vec<String>,

    // Auth
    pub anthropic_api_key: Option<String>,
    pub claude_code_oauth_token: Option<String>,
    pub gemini_api_key: Option<String>,
    pub google_api_key: Option<String>,
    pub github_token: Option<String>,

    // Provider models
    pub claude_model: String,
    pub claude_allowed_tools: String,
    pub gemini_model: String,

    // Per-agent model overrides
    pub agent_models: AgentModelOverrides,
    // Per-agent iteration overrides
    pub agent_max_iterations: AgentIterationOverrides,

    // Installation root (where agents/, templates/ live)
    pub root_dir: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct AgentModelOverrides {
    pub architect: Option<String>,
    pub designer: Option<String>,
    pub migration: Option<String>,
    pub developer: Option<String>,
    pub accessibility: Option<String>,
    pub tester: Option<String>,
    pub performance: Option<String>,
    pub secops: Option<String>,
    pub dependency: Option<String>,
    pub infrastructure: Option<String>,
    pub devops: Option<String>,
    pub rollback: Option<String>,
    pub documentation: Option<String>,
    pub reviewer: Option<String>,
}

impl AgentModelOverrides {
    pub fn for_agent(&self, name: &str) -> Option<&str> {
        match name {
            "architect" => self.architect.as_deref(),
            "designer" => self.designer.as_deref(),
            "migration" => self.migration.as_deref(),
            "developer" => self.developer.as_deref(),
            "accessibility" => self.accessibility.as_deref(),
            "tester" => self.tester.as_deref(),
            "performance" => self.performance.as_deref(),
            "secops" => self.secops.as_deref(),
            "dependency" => self.dependency.as_deref(),
            "infrastructure" => self.infrastructure.as_deref(),
            "devops" => self.devops.as_deref(),
            "rollback" => self.rollback.as_deref(),
            "documentation" => self.documentation.as_deref(),
            "reviewer" => self.reviewer.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AgentIterationOverrides {
    pub architect: Option<u32>,
    pub designer: Option<u32>,
    pub migration: Option<u32>,
    pub developer: Option<u32>,
    pub accessibility: Option<u32>,
    pub tester: Option<u32>,
    pub performance: Option<u32>,
    pub secops: Option<u32>,
    pub dependency: Option<u32>,
    pub infrastructure: Option<u32>,
    pub devops: Option<u32>,
    pub rollback: Option<u32>,
    pub documentation: Option<u32>,
    pub reviewer: Option<u32>,
}

impl AgentIterationOverrides {
    pub fn for_agent(&self, name: &str) -> Option<u32> {
        match name {
            "architect" => self.architect,
            "designer" => self.designer,
            "migration" => self.migration,
            "developer" => self.developer,
            "accessibility" => self.accessibility,
            "tester" => self.tester,
            "performance" => self.performance,
            "secops" => self.secops,
            "dependency" => self.dependency,
            "infrastructure" => self.infrastructure,
            "devops" => self.devops,
            "rollback" => self.rollback,
            "documentation" => self.documentation,
            "reviewer" => self.reviewer,
            _ => None,
        }
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn env_parse<T: std::str::FromStr>(key: &str) -> Option<T> {
    env_opt(key).and_then(|v| v.parse().ok())
}

fn env_bool(key: &str) -> Option<bool> {
    env_opt(key).map(|v| matches!(v.as_str(), "true" | "1" | "yes"))
}

/// Locate the installation root by walking up from the current executable.
fn find_root_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        // In dev: target/debug/wisp -> walk up to find agents/ + templates/
        // In install: /usr/local/bin/wisp -> fall back to ~/.wisp
        let mut dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
        for _ in 0..4 {
            if dir.join("agents").is_dir() && dir.join("templates").is_dir() {
                return dir;
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    // Fallback: check env, then default install location
    if let Some(root) = env_opt("WISP_ROOT_DIR") {
        return PathBuf::from(root);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".wisp")
}

impl Config {
    /// Load configuration from .env file + environment variables.
    /// CLI flags take precedence and should be applied after this call.
    pub fn load() -> Self {
        let root_dir = find_root_dir();
        let env_file = root_dir.join(".env");
        if env_file.exists() {
            let _ = dotenvy::from_path(&env_file);
        }

        let evidence_str = env_opt("EVIDENCE_AGENTS")
            .unwrap_or_else(|| "tester,performance,secops,dependency,infrastructure,devops".into());
        let evidence_agents: Vec<String> = evidence_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Self {
            provider: match env_opt("AI_PROVIDER").as_deref() {
                Some("gemini") => ProviderKind::Gemini,
                _ => ProviderKind::Claude,
            },
            log_dir: env_opt("LOG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./logs")),
            log_level: env_opt("LOG_LEVEL").unwrap_or_else(|| "info".into()),
            verbose_logs: env_bool("VERBOSE_LOGS").unwrap_or(false),
            interactive: env_bool("INTERACTIVE").unwrap_or(false),
            work_dir: env_opt("PIPELINE_WORK_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/tmp/coding-agents-work")),
            max_iterations: env_parse("PIPELINE_MAX_ITERATIONS").unwrap_or(10),
            max_parallel: env_parse("PIPELINE_MAX_PARALLEL").unwrap_or(4),
            default_base_branch: env_opt("DEFAULT_BASE_BRANCH").unwrap_or_else(|| "main".into()),
            use_devcontainer: env_bool("USE_DEVCONTAINER").unwrap_or(true),
            update_project_context: env_bool("UPDATE_PROJECT_CONTEXT").unwrap_or(true),
            cleanup: env_bool("PIPELINE_CLEANUP").unwrap_or(false),
            evidence_agents,

            anthropic_api_key: env_opt("ANTHROPIC_API_KEY"),
            claude_code_oauth_token: env_opt("CLAUDE_CODE_OAUTH_TOKEN"),
            gemini_api_key: env_opt("GEMINI_API_KEY"),
            google_api_key: env_opt("GOOGLE_API_KEY"),
            github_token: env_opt("GITHUB_TOKEN"),

            claude_model: env_opt("CLAUDE_MODEL").unwrap_or_else(|| "sonnet".into()),
            claude_allowed_tools: env_opt("CLAUDE_ALLOWED_TOOLS")
                .unwrap_or_else(|| "Edit,Write,Bash,Read,MultiEdit".into()),
            gemini_model: env_opt("GEMINI_MODEL").unwrap_or_else(|| "gemini-2.5-pro".into()),

            agent_models: AgentModelOverrides {
                architect: env_opt("ARCHITECT_MODEL"),
                designer: env_opt("DESIGNER_MODEL"),
                migration: env_opt("MIGRATION_MODEL"),
                developer: env_opt("DEVELOPER_MODEL"),
                accessibility: env_opt("ACCESSIBILITY_MODEL"),
                tester: env_opt("TESTER_MODEL"),
                performance: env_opt("PERFORMANCE_MODEL"),
                secops: env_opt("SECOPS_MODEL"),
                dependency: env_opt("DEPENDENCY_MODEL"),
                infrastructure: env_opt("INFRASTRUCTURE_MODEL"),
                devops: env_opt("DEVOPS_MODEL"),
                rollback: env_opt("ROLLBACK_MODEL"),
                documentation: env_opt("DOCUMENTATION_MODEL"),
                reviewer: env_opt("REVIEWER_MODEL"),
            },

            agent_max_iterations: AgentIterationOverrides {
                architect: env_parse("ARCHITECT_MAX_ITERATIONS"),
                designer: env_parse("DESIGNER_MAX_ITERATIONS"),
                migration: env_parse("MIGRATION_MAX_ITERATIONS"),
                developer: env_parse("DEVELOPER_MAX_ITERATIONS"),
                accessibility: env_parse("ACCESSIBILITY_MAX_ITERATIONS"),
                tester: env_parse("TESTER_MAX_ITERATIONS"),
                performance: env_parse("PERFORMANCE_MAX_ITERATIONS"),
                secops: env_parse("SECOPS_MAX_ITERATIONS"),
                dependency: env_parse("DEPENDENCY_MAX_ITERATIONS"),
                infrastructure: env_parse("INFRASTRUCTURE_MAX_ITERATIONS"),
                devops: env_parse("DEVOPS_MAX_ITERATIONS"),
                rollback: env_parse("ROLLBACK_MAX_ITERATIONS"),
                documentation: env_parse("DOCUMENTATION_MAX_ITERATIONS"),
                reviewer: env_parse("REVIEWER_MAX_ITERATIONS"),
            },

            root_dir,
        }
    }

    pub fn default_model(&self) -> &str {
        match self.provider {
            ProviderKind::Claude => &self.claude_model,
            ProviderKind::Gemini => &self.gemini_model,
        }
    }

    pub fn model_for_agent(&self, agent: &str) -> String {
        self.agent_models
            .for_agent(agent)
            .unwrap_or(self.default_model())
            .to_string()
    }

    pub fn max_iterations_for_agent(&self, agent: &str) -> u32 {
        self.agent_max_iterations
            .for_agent(agent)
            .unwrap_or(self.max_iterations)
    }

    pub fn context_filename(&self) -> &str {
        match self.provider {
            ProviderKind::Claude => "CLAUDE.md",
            ProviderKind::Gemini => "GEMINI.md",
        }
    }
}
