use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(
    name = "wisp",
    about = "AI agent pipeline: PRDs to Pull Requests",
    long_about = "Turns Product Requirements Documents into Pull Requests using AI coding agents, \
                  Ralph Loops, and Dev Containers.",
    version
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// AI provider to use
    #[arg(long, global = true, env = "AI_PROVIDER", default_value = "claude")]
    pub provider: ProviderKind,

    /// Focus output on a specific agent (e.g. --follow developer)
    #[arg(long, global = true)]
    pub follow: Option<String>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Run the manifest orchestrator (epics run in parallel by default when multiple; use --sequential-epics for one-at-a-time)
    Orchestrate(OrchestrateArgs),

    /// Run a single PRD x repo pipeline
    Pipeline(PipelineArgs),

    /// Run a single agent in a Ralph Loop
    Run(RunArgs),

    /// Generate PRDs or context skills
    Generate {
        #[command(subcommand)]
        cmd: GenerateCmd,
    },

    /// Tail agent logs in real-time
    Monitor(MonitorArgs),

    /// Re-format a raw .jsonl log file for reading
    Logs(LogsArgs),

    /// Install components (skills, etc.)
    Install {
        #[command(subcommand)]
        cmd: InstallCmd,
    },

    /// Self-update to the latest version
    Update,
}

#[derive(Clone, Copy, ValueEnum, Debug, PartialEq, Eq)]
pub enum ProviderKind {
    Claude,
    Gemini,
}

impl std::fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Claude => write!(f, "claude"),
            Self::Gemini => write!(f, "gemini"),
        }
    }
}

// ---------------------------------------------------------------------------
// Subcommand arg structs
// ---------------------------------------------------------------------------

#[derive(Clone, clap::Args)]
pub struct OrchestrateArgs {
    /// Path to manifest JSON file
    #[arg(long)]
    pub manifest: PathBuf,

    /// Run epics one after another and each subtask/repo pipeline strictly serial (no concurrency)
    #[arg(long)]
    pub sequential: bool,

    /// Run manifest epics sequentially (shared `PIPELINE_WORK_DIR`). Default is parallel epics with isolated clones under `{work_dir}/epics/{index}/`
    #[arg(long)]
    pub sequential_epics: bool,

    /// Max concurrent pipelines across all epics (subtasks in an epic still run in manifest order)
    #[arg(long, env = "PIPELINE_MAX_PARALLEL", default_value = "4")]
    pub max_parallel: usize,

    /// Skip PR creation (dry-run)
    #[arg(long)]
    pub skip_pr: bool,

    /// Pause between agents / iterations for review
    #[arg(long, env = "INTERACTIVE")]
    pub interactive: bool,

    /// Run only a specific epic (1-based)
    #[arg(long, visible_alias = "order")]
    pub epic: Option<usize>,

    /// Comma-separated agent list (overrides manifest & default)
    #[arg(long, value_delimiter = ',')]
    pub agents: Option<Vec<String>>,

    /// Max Ralph Loop iterations per agent
    #[arg(long, env = "PIPELINE_MAX_ITERATIONS", default_value = "2")]
    pub max_iterations: u32,

    /// Working directory for cloned repos
    #[arg(
        long,
        env = "PIPELINE_WORK_DIR",
        default_value = "/tmp/coding-agents-work"
    )]
    pub work_dir: PathBuf,

    /// Agents whose reports become PR comments
    #[arg(
        long,
        env = "EVIDENCE_AGENTS",
        value_delimiter = ',',
        default_value = "tester,performance,secops,dependency,infrastructure,devops"
    )]
    pub evidence_agents: Vec<String>,

    /// Show verbose agent output (thinking, tool calls)
    #[arg(long, env = "VERBOSE_LOGS")]
    pub verbose_logs: bool,

    /// Reuse one Dev Container for all agents in each pipeline (faster; default is a fresh container per agent)
    #[arg(long, env = "WISP_REUSE_DEVCONTAINER")]
    pub reuse_devcontainer: bool,
}

#[derive(clap::Args)]
pub struct PipelineArgs {
    /// Path to PRD markdown file
    #[arg(long)]
    pub prd: PathBuf,

    /// Repository URL
    #[arg(long)]
    pub repo: String,

    /// Base branch
    #[arg(long, env = "DEFAULT_BASE_BRANCH", default_value = "main")]
    pub branch: String,

    /// Path to context directory or file
    #[arg(long)]
    pub context: Option<PathBuf>,

    /// Skip PR creation
    #[arg(long)]
    pub skip_pr: bool,

    /// Disable Dev Container isolation
    #[arg(long)]
    pub no_devcontainer: bool,

    /// Pause between agents / iterations
    #[arg(long, env = "INTERACTIVE")]
    pub interactive: bool,

    /// Comma-separated agent list
    #[arg(long, value_delimiter = ',')]
    pub agents: Option<Vec<String>>,

    /// Max Ralph Loop iterations per agent
    #[arg(long, env = "PIPELINE_MAX_ITERATIONS", default_value = "2")]
    pub max_iterations: u32,

    /// Working directory for cloned repos
    #[arg(
        long,
        env = "PIPELINE_WORK_DIR",
        default_value = "/tmp/coding-agents-work"
    )]
    pub work_dir: PathBuf,

    /// Branch to stack on (creates PR targeting this branch)
    #[arg(long)]
    pub stack_on: Option<String>,

    /// Agents whose reports become PR comments
    #[arg(
        long,
        env = "EVIDENCE_AGENTS",
        value_delimiter = ',',
        default_value = "tester,performance,secops,dependency,infrastructure,devops"
    )]
    pub evidence_agents: Vec<String>,

    /// Show verbose agent output
    #[arg(long, env = "VERBOSE_LOGS")]
    pub verbose_logs: bool,

    /// Reuse one Dev Container for all agents (faster; default is a fresh container per agent)
    #[arg(long, env = "WISP_REUSE_DEVCONTAINER")]
    pub reuse_devcontainer: bool,
}

#[derive(clap::Args)]
pub struct RunArgs {
    /// Agent name (e.g. architect, developer, tester)
    #[arg(long)]
    pub agent: String,

    /// Working directory (the repo checkout)
    #[arg(long)]
    pub workdir: PathBuf,

    /// Path to PRD markdown file
    #[arg(long)]
    pub prd: PathBuf,

    /// Max Ralph Loop iterations
    #[arg(long, env = "PIPELINE_MAX_ITERATIONS", default_value = "2")]
    pub max_iterations: u32,

    /// Comma-separated list of previously-run agents (for context)
    #[arg(long, value_delimiter = ',')]
    pub previous_agents: Option<Vec<String>>,

    /// Show verbose agent output
    #[arg(long, env = "VERBOSE_LOGS")]
    pub verbose_logs: bool,

    /// Pause between iterations
    #[arg(long, env = "INTERACTIVE")]
    pub interactive: bool,

    /// Model override for this agent
    #[arg(long)]
    pub model: Option<String>,
}

#[derive(Subcommand)]
pub enum GenerateCmd {
    /// Generate PRDs and manifest interactively
    Prd(GeneratePrdArgs),

    /// Generate context skills by analyzing a repository
    Context(GenerateContextArgs),
}

#[derive(clap::Args)]
pub struct GeneratePrdArgs {
    /// Output directory for generated PRDs
    #[arg(long)]
    pub output: PathBuf,

    /// Full path to the manifest JSON file (a `.json` extension is added if missing or non-JSON)
    #[arg(long)]
    pub manifest: PathBuf,

    /// Repository URLs (can be repeated)
    #[arg(long = "repo")]
    pub repos: Vec<String>,

    /// Context directories matching each --repo (can be repeated)
    #[arg(long = "context")]
    pub contexts: Vec<PathBuf>,

    /// Project description (what to build). If omitted, prompts interactively or reads from stdin.
    #[arg(long)]
    pub description: Option<String>,

    /// Show verbose output
    #[arg(long, env = "VERBOSE_LOGS")]
    pub verbose_logs: bool,

    /// Pause between iterations
    #[arg(long, env = "INTERACTIVE")]
    pub interactive: bool,
}

#[derive(clap::Args)]
pub struct GenerateContextArgs {
    /// Repository URL to analyze
    #[arg(long)]
    pub repo: String,

    /// Output directory for context skill files
    #[arg(long)]
    pub output: PathBuf,

    /// Base branch to analyze
    #[arg(long, default_value = "main")]
    pub branch: String,

    /// Show verbose output
    #[arg(long, env = "VERBOSE_LOGS")]
    pub verbose_logs: bool,

    /// Pause between iterations
    #[arg(long, env = "INTERACTIVE")]
    pub interactive: bool,
}

#[derive(Subcommand)]
pub enum InstallCmd {
    /// Install Cursor skills as symlinks
    Skills(InstallSkillsArgs),

    /// Download agent prompt files from GitHub to ~/.wisp/agents/
    Agents(InstallAgentsArgs),
}

#[derive(clap::Args)]
pub struct InstallAgentsArgs {
    /// Destination directory (default: ~/.wisp/agents/)
    #[arg(long)]
    pub output: Option<PathBuf>,

    /// Overwrite existing files
    #[arg(long)]
    pub force: bool,
}

#[derive(clap::Args)]
pub struct InstallSkillsArgs {
    /// Install to a project-specific directory instead of ~/.cursor/skills/
    #[arg(long)]
    pub project: Option<PathBuf>,
}

#[derive(clap::Args)]
pub struct MonitorArgs {
    /// Filter logs by agent name
    #[arg(long)]
    pub agent: Option<String>,

    /// List resumable sessions
    #[arg(long)]
    pub sessions: bool,

    /// Tail .jsonl event files (formatted for readability)
    #[arg(long)]
    pub raw: bool,

    /// Log directory to monitor
    #[arg(long, env = "LOG_DIR", default_value = "./logs")]
    pub log_dir: PathBuf,
}

#[derive(clap::Args)]
pub struct LogsArgs {
    /// Path to the .jsonl file to format
    pub file: PathBuf,

    /// Max characters for tool input/result display
    #[arg(long, default_value = "500")]
    pub truncate: usize,
}
