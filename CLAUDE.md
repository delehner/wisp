# Wisp — Overview

Wisp is a **single Rust binary** that turns Product Requirements Documents (PRDs) into fully implemented Pull Requests by orchestrating AI coding agents in isolated Dev Containers.

**Repository**: https://github.com/delehner/wisp
**Tech Stack**: Rust (tokio async, clap, serde), Claude Code CLI, Gemini CLI, GitHub CLI (`gh`), Docker Dev Containers
**Binary name**: `wisp`

## What It Does

1. Reads a **manifest** JSON file listing PRDs, target repositories, and agent sequences
2. Clones repos, creates feature branches, starts Dev Containers
3. Runs a **Ralph Loop** — iterative AI agent execution — for each agent in the pipeline
4. Each agent reads/writes `.agent-progress/` files to track progress across iterations
5. After all agents complete, rebases the branch and opens a Pull Request via `gh pr create`

## AI Providers

- **Claude Code** (`claude`): Uses `--dangerously-skip-permissions --output-format stream-json`
- **Gemini CLI** (`gemini`): Uses `--yolo --output-format stream-json`

## Pipeline Order (14 agents)

Architect → Designer → Migration → Developer → Accessibility → Tester → Performance → SecOps → Dependency → Infrastructure → DevOps → Rollback → Documentation → Reviewer

Non-blocking agents (failures don't stop pipeline): Designer, Migration, Accessibility, Performance, Dependency, Rollback, Documentation

## Key CLI Commands

```bash
wisp orchestrate --manifest manifests/my.json   # Run full manifest
wisp pipeline --prd path/to/prd.md --repo https://github.com/org/repo
wisp run --agent developer --workdir /path --prd path/to/prd.md
wisp generate prd --output prds/ --manifest manifests/my.json --repo https://github.com/org/repo
wisp generate context --repo https://github.com/org/repo --output contexts/myrepo
wisp monitor --log-dir ./logs                    # Tail agent logs in real-time
wisp logs path/to/file.jsonl                     # Re-format a raw JSONL log
wisp install skills                              # Symlink Cursor skills
wisp update                                      # Self-update to latest version
```

---

# Architecture

## Directory Structure

```
src/
├── main.rs                    # Entry point, CLI dispatch, generate/install commands
├── cli.rs                     # Clap derive structs for all subcommands and flags
├── config.rs                  # .env loading, per-agent model/iteration overrides
├── utils.rs                   # exec_streaming(), exec_capture(), command_exists(), slugify()
├── manifest/mod.rs            # Manifest, Order, PrdEntry, Repository structs (serde)
├── prd/mod.rs                 # PRD struct, markdown metadata extraction
├── provider/
│   ├── mod.rs                 # Provider trait, RunOutcome, RunOpts, create_provider()
│   ├── claude.rs              # Claude Code CLI arg builder + session ID extraction
│   └── gemini.rs              # Gemini CLI arg builder + session ID extraction
├── pipeline/
│   ├── mod.rs                 # DEFAULT_AGENTS, NON_BLOCKING_AGENTS, is_blocking()
│   ├── orchestrator.rs        # Manifest dispatch, wave stacking, parallel execution
│   ├── runner.rs              # Single PRD × repo pipeline (clone → agents → PR)
│   ├── agent.rs               # Ralph Loop: prompt assembly, iteration, completion detection
│   └── devcontainer.rs        # Dev Container lifecycle with RAII Drop impl
├── git/
│   ├── mod.rs                 # clone_or_prepare(), create_feature_branch(), rebase_onto_latest()
│   └── pr.rs                  # gh pr create, evidence comment posting
├── context/mod.rs             # Skill assembly in canonical order, frontmatter stripping
└── logging/
    ├── mod.rs                 # Tracing subscriber init
    ├── formatter.rs           # JSONL → human-readable output (Claude + Gemini event types)
    └── monitor.rs             # Real-time log tailing via notify crate

agents/                        # Agent prompt files (_base-system.md + per-agent prompt.md)
contexts/                      # Per-repo context skill directories (assembled into CLAUDE.md)
manifests/                     # Manifest JSON files
skills/                        # Cursor-compatible agent skills
templates/                     # PRD, manifest, context-skill templates
docs/                          # Mermaid diagrams and reference documentation
```

## Key Patterns

- **Provider trait** (`src/provider/mod.rs`): Abstraction over Claude/Gemini CLIs. Implement `build_run_args()`, `extract_session_id()` to add a new provider.
- **Ralph Loop** (`src/pipeline/agent.rs`): Iterative agent execution. Each iteration assembles a prompt, runs the CLI, checks for `## Status: COMPLETED` in `.agent-progress/<agent>.md`, and loops until complete or max iterations reached.
- **Wave stacking** (`src/pipeline/orchestrator.rs`): Multiple PRDs targeting the same repo are serialized into waves. Each wave branches from the previous feature branch.
- **RAII DevContainers** (`src/pipeline/devcontainer.rs`): `Drop` impl warns if container was not explicitly stopped. Always call `stop()` in the happy path.
- **Filesystem memory**: Agents read/write `.agent-progress/` files for state across iterations. Progress tracked via presence of `## Status: COMPLETED` marker.

## Data Flow

```
manifest.json
  → orchestrator: parse orders, build work units, detect same-repo conflicts, split into waves
    → runner (per PRD × repo):
        1. clone_or_prepare() — clone or fetch latest
        2. create_feature_branch() — check out feature branch
        3. assemble_skills() → write CLAUDE.md / GEMINI.md
        4. DevContainer::start() (optional)
        5. AgentRunner::run() × N agents (Ralph Loop)
        6. rebase_onto_latest()
        7. create_pull_request() + post_pr_evidence()
```

## Parallel Execution

`tokio::sync::Semaphore` limits concurrency to `Config::max_parallel`. PRDs within the same order run concurrently (via `tokio::task::JoinSet`). Same-repo PRDs are forced into sequential waves.

---

# Conventions

## Rust Style

- **Edition**: Rust 2021
- **Formatter**: `cargo fmt` — run before every commit
- **Linter**: `cargo clippy` — zero warnings policy
- **Error handling**: `anyhow::Result` at application boundaries; `thiserror` for library-style typed errors on structs

## Error Handling

```rust
// Use anyhow::Result with context for callsite context
fn do_thing() -> anyhow::Result<()> {
    some_op().context("failed to do X")?;
    Ok(())
}

// Use thiserror for domain errors that need matching
#[derive(thiserror::Error, Debug)]
enum PipelineError {
    #[error("agent {0} failed: {1}")]
    AgentFailed(String, String),
}
```

- Always add `.context("...")` or `.with_context(|| ...)` when propagating with `?`
- Prefer `anyhow::bail!()` over `return Err(anyhow!(...))` for early exits

## Async Patterns

- Runtime: `tokio` with `#[tokio::main]` at top level
- All I/O is async; blocking calls use `tokio::task::spawn_blocking`
- Parallel tasks use `tokio::task::JoinSet`
- Concurrency limiting uses `tokio::sync::Semaphore`
- Cancellation uses `tokio_util::sync::CancellationToken`

## Command Execution

Always use helpers from `src/utils.rs`, not raw `std::process::Command`:

```rust
// Stream output with callbacks
exec_streaming(&["git", "clone", url], dir, |line| { ... }, |line| { ... }).await?;

// Capture full output
let (stdout, stderr) = exec_capture(&["gh", "pr", "create", ...], dir).await?;
```

## Logging

Use `tracing` macros, not `println!`:

```rust
tracing::info!(agent = %name, iteration = i, "starting agent");
tracing::warn!("container not stopped explicitly");
tracing::error!(err = %e, "pipeline failed");
```

Log level is set via `LOG_LEVEL` env var (default: `info`).

## Naming

- **Modules**: snake_case (`pipeline/orchestrator.rs`)
- **Structs/Enums/Traits**: PascalCase (`AgentRunner`, `PrdStatus`, `Provider`)
- **Functions/variables**: snake_case (`build_run_args`, `max_iterations`)
- **Constants**: UPPER_SNAKE (`DEFAULT_AGENTS`, `NON_BLOCKING_AGENTS`)
- **CLI flags**: kebab-case (`--max-iterations`, `--skip-pr`)

## Code Organization

- Keep functions focused; prefer ~50 lines per function
- Put associated helpers close to the type they serve
- Avoid `pub` on internal implementation details — only expose what crosses module boundaries
- Tests go in `#[cfg(test)]` modules at the bottom of the file

---

# Key Components

## Provider Trait (`src/provider/mod.rs`)

Abstraction over Claude Code and Gemini CLIs:

```rust
trait Provider: Send + Sync {
    fn cli_name(&self) -> &str;                          // "claude" or "gemini"
    fn context_filename(&self) -> &str;                  // "CLAUDE.md" or "GEMINI.md"
    fn npm_package(&self) -> &str;                       // npm package name for install
    fn validate_cli(&self) -> anyhow::Result<()>;        // check CLI is in PATH
    fn build_run_args(&self, prompt_file: &Path, opts: &RunOpts) -> Vec<String>;
    fn extract_session_id(&self, lines: &[String]) -> Option<String>;
    fn resume_hint(&self, session_id: &str) -> String;   // default impl provided
    fn auth_check_cmd(&self) -> String;                  // default impl provided
}
```

- `create_provider(config: &Config) -> Box<dyn Provider>` is the factory function
- To add a provider: implement the trait in `src/provider/<name>.rs`, add variant to `ProviderKind` in `src/cli.rs`, register in `create_provider()`

## Ralph Loop (`src/pipeline/agent.rs`)

The core execution loop for a single agent:

1. Check if `.agent-progress/<agent>.md` contains `## Status: COMPLETED` → skip if done
2. Assemble prompt in strict order: base system + agent prompt + PRD + previous agent progress + own progress + architecture doc + design doc + context + iteration metadata
3. Run `Provider::build_run_args()` → spawn CLI process → stream stdout to JSONL log + stderr to formatted log
4. Extract and persist session ID for resumable sessions
5. Re-check completion status after each iteration
6. In interactive mode: prompt user to skip/continue/abort between iterations
7. Sleep 2s between iterations; return `AgentOutcome` (Completed/MaxIterationsReached/Skipped/Failed)

**Completion detection**: Reads `.agent-progress/<agent>.md` and looks for `## Status: COMPLETED`.

## Context Assembly (`src/context/mod.rs`)

Assembles per-repo context skills into a single `CLAUDE.md` or `GEMINI.md`:

- Reads all `.md` files from the context directory
- Orders canonically: overview → architecture → conventions → components → api → database → testing → build-deploy → environment → integrations → remaining (alphabetical)
- Strips YAML frontmatter (`--- ... ---`) from each file
- Joins with `\n---\n\n` separator
- Backward-compatible with single-file contexts (non-directory path)

## Dev Container (`src/pipeline/devcontainer.rs`)

RAII lifecycle wrapper:

```rust
let dc = DevContainer::start(&workdir).await?;
dc.exec(&["cargo", "test"], None).await?;
dc.stop().await?;   // must call explicitly; Drop warns if skipped
```

- `start()` runs `devcontainer up` and parses JSON output for `containerId` and `remoteWorkspaceFolder`
- `exec()` runs commands via `devcontainer exec` with optional env vars
- Used only when `Config::use_devcontainer` is true

## Manifest + Orchestrator (`src/manifest/`, `src/pipeline/orchestrator.rs`)

- `Manifest::load(path)`: Parses JSON, resolves relative paths against the manifest directory
- `Order`: Sequential unit — orders execute one at a time
- `PrdEntry`: A PRD file with a list of target `Repository` entries
- Same-repo PRDs within an order are automatically stacked into sequential waves
- `execute_units()`: tokio `JoinSet` + `Semaphore` for bounded parallel execution

## Agent Prompts (`agents/`)

Each agent has:
- `agents/<name>/prompt.md`: Agent-specific instructions, responsibilities, workflow, completion criteria
- `agents/_base-system.md`: Shared conventions — progress tracking format, git conventions, quality standards

When adding a new agent, always read `_base-system.md` first to avoid duplicating shared instructions.

## Git Operations (`src/git/`)

- `clone_or_prepare()`: Clones or fetches; handles empty repos by seeding initial commit
- `create_feature_branch()`: Creates `agent/<slug>-YYYYMMDD` branch name; checks out existing branch if already exists (for stacked waves)
- `rebase_onto_latest()`: Rebases feature branch onto base; aborts on conflict (pipeline fails loudly)
- `write_git_excludes()`: Adds pipeline files to `.git/info/exclude` (not `.gitignore`)

---

# Testing

## Running Tests

```bash
cargo test              # run all tests
cargo test -- --nocapture  # show println! output during tests
cargo clippy            # linting (treat warnings as errors in CI)
cargo fmt --check       # formatting check
```

## Test Location

Tests live in `#[cfg(test)]` modules at the bottom of each source file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_something() { ... }
}
```

## What Is Tested

Current test coverage focuses on pure functions:

- `src/prd/mod.rs`: PRD metadata extraction (title parsing, field extraction, slugification)
- `src/utils.rs`: `repo_name_from_url()` — URL parsing edge cases
- `src/context/mod.rs`: `strip_frontmatter()` — YAML header stripping

## What Is NOT Unit-Tested (integration/manual)

- CLI execution (`exec_streaming`, `exec_capture`) — requires real processes
- Git operations — require real git repos
- Provider trait implementations — require real Claude/Gemini CLIs
- Pipeline orchestration — integration tested via `wisp run`/`wisp pipeline`

## Adding Tests

For pure functions, add tests directly in the module. For anything requiring external processes or filesystem, prefer integration testing via the CLI itself.

When writing tests for PRD/context parsing, use inline strings rather than fixture files to keep tests self-contained:

```rust
#[test]
fn test_strip_frontmatter() {
    let input = "---\nname: foo\n---\n\n# Content";
    let result = strip_frontmatter(input);
    assert_eq!(result, "# Content");
}
```

---

# Build & Deploy

## Local Development

```bash
cargo build             # debug build
cargo build --release   # release build (wisp binary in target/release/wisp)
cargo test              # run tests
cargo clippy            # lint
cargo fmt               # format
```

## Release Profile

Configured in `Cargo.toml` for minimal binary size:
- `opt-level = "z"` — optimize for size
- `lto = true` — link-time optimization
- `codegen-units = 1` — single codegen unit for better optimization
- `strip = true` — strip debug symbols

## Cross-Compilation Targets

The binary must compile for all four targets:
- `aarch64-apple-darwin` (macOS Apple Silicon)
- `x86_64-apple-darwin` (macOS Intel)
- `aarch64-unknown-linux-gnu` (Linux ARM64)
- `x86_64-unknown-linux-gnu` (Linux x86_64)

CI uses GitHub Actions with cross-compilation via the `cross` tool.

## CI Pipeline (`.github/workflows/`)

- **CI workflow**: `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` on every PR
- **Release workflow**: Triggered on version tags (`v*`). Cross-compiles all four targets, uploads binaries to GitHub Releases.

## Installation

End users install via:
```bash
curl -fsSL https://raw.githubusercontent.com/delehner/wisp/main/scripts/install.sh | bash
```

`scripts/install.sh` is the only non-devcontainer shell script. It downloads the appropriate binary from GitHub Releases based on `uname`.

## Adding a New Agent (affects build)

When adding a new agent to `DEFAULT_AGENTS` in `src/pipeline/mod.rs`, also add corresponding fields to `AgentModelOverrides` and `AgentIterationOverrides` in `src/config.rs`. Missing fields cause compilation errors.

---

# Environment & Configuration

Configuration is loaded by `src/config.rs` via `dotenvy` from a `.env` file in the wisp installation root. All variables can also be set as real environment variables.

## Provider Selection

```env
AI_PROVIDER=claude        # or: gemini (default: claude)
```

## Auth Tokens

```env
ANTHROPIC_API_KEY=sk-ant-...        # Claude API (if using API key auth)
CLAUDE_CODE_OAUTH_TOKEN=...         # Claude Code OAuth token (alternative)
GEMINI_API_KEY=...                  # Gemini API key
GOOGLE_API_KEY=...                  # Google API key (alternative for Gemini)
GITHUB_TOKEN=ghp_...                # GitHub token (for gh pr create)
```

## Model Selection

```env
CLAUDE_MODEL=sonnet                  # default Claude model (default: "sonnet")
GEMINI_MODEL=gemini-2.5-pro          # default Gemini model
CLAUDE_ALLOWED_TOOLS=Edit,Write,Bash,Read,MultiEdit   # tools Claude Code may use
```

### Per-Agent Model Overrides

Each of the 14 agents can use a different model:
```env
ARCHITECT_MODEL=claude-opus-4-6
DEVELOPER_MODEL=claude-sonnet-4-6
TESTER_MODEL=claude-haiku-4-5-20251001
# ... (architect, designer, migration, developer, accessibility, tester,
#      performance, secops, dependency, infrastructure, devops, rollback,
#      documentation, reviewer)
```

## Pipeline Defaults

```env
PIPELINE_MAX_PARALLEL=4               # max concurrent PRD pipelines (default: 4)
PIPELINE_MAX_ITERATIONS=10            # default Ralph Loop iterations per agent
DEFAULT_BASE_BRANCH=main              # default base branch
PIPELINE_WORK_DIR=/tmp/coding-agents-work  # directory for cloned repos
PIPELINE_CLEANUP=false                # remove workdirs after pipeline (default: false)
USE_DEVCONTAINER=true                 # run agents inside dev containers
UPDATE_PROJECT_CONTEXT=true           # update context file at pipeline start
INTERACTIVE=false                     # pause between agents for review
```

### Per-Agent Max Iteration Overrides

```env
ARCHITECT_MAX_ITERATIONS=5
DEVELOPER_MAX_ITERATIONS=15
# ... same pattern for all 14 agents
```

## Evidence Agents

```env
EVIDENCE_AGENTS=tester,performance,secops,dependency,infrastructure,devops
# agents whose progress reports become PR comments (default includes all 6 above)
```

## Logging

```env
LOG_LEVEL=info                        # log level (trace/debug/info/warn/error)
LOG_DIR=./logs                        # JSONL log output directory
VERBOSE_LOGS=false                    # enable verbose CLI output (tool calls, thinking)
```

## MCP Integrations (optional)

Configured in `.mcp.json`. Tokens for external services:
```env
NOTION_TOKEN=...
FIGMA_TOKEN=...
SLACK_TOKEN=...
JIRA_TOKEN=...
```

See `docs/mcp-integrations.md` for setup details.

---

# Integrations

## AI CLI Tools

### Claude Code (`claude`)
- Installed separately; checked via `which claude`
- Invoked as: `claude -p <prompt-file> --model <model> --dangerously-skip-permissions --output-format stream-json --allowedTools <tools> --verbose`
- `--verbose` is required for `stream-json` output format
- Session resumption: extract session ID from first JSONL lines via `extract_session_id(lines: &[String])`; use `--resume <id>` to continue

### Gemini CLI (`gemini`)
- Installed separately; checked via `which gemini`
- Invoked as: `gemini -p <prompt-file> --model <model> --yolo --output-format stream-json`
- Session resumption: extract session ID from first JSONL lines via `extract_session_id(lines: &[String])`

## GitHub CLI (`gh`)

Required for PR operations:
- `gh pr create --title "..." --body "..." --base <branch>` — creates PR
- `gh pr comment <pr-url> --body-file <path>` — posts evidence comments
- Must be authenticated (`gh auth login`) before running wisp

## Docker / Dev Containers

- Uses the `devcontainer` CLI (from `@devcontainers/cli`)
- `devcontainer up --workspace-folder <path>` — start container, returns JSON with `containerId`
- `devcontainer exec --workspace-folder <path> -- <cmd>` — run command in container
- Container cleanup: `docker stop <id> && docker rm <id>`
- Dev Container config expected at `.devcontainer/devcontainer.json` in the target repo

## MCP Servers (optional)

Configured in `.mcp.json` at the project root. Used by Claude Code to access external services:

| Server | Purpose |
|--------|---------|
| `github` | Read issues, PRs, repo metadata |
| `notion` | Read design specs and requirements |
| `figma` | Read UI designs |
| `slack` | Read channel context |

MCP is only active when `claude` is the provider and the target repo has Claude Code support. See `docs/mcp-integrations.md`.

## notify Crate (log monitoring)

`src/logging/monitor.rs` uses the `notify` crate to watch log directories for new `.log` and `.jsonl` files and tail them in real-time. This powers `wisp monitor`.
