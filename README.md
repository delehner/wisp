# Coding Agents Pipeline

A single Rust binary that turns PRDs into Pull Requests using AI coding agents (Claude Code or Gemini CLI), Ralph Loops, and Dev Containers.

```
Description → ca generate prd → PRDs + Manifest
Manifest → ca orchestrate → [Architect → Designer → Migration → Developer → Accessibility →
  Tester → Performance → SecOps → Dependency → Infrastructure → DevOps → Rollback →
  Documentation → Reviewer] → Pull Requests
```

## Install

**Pre-built binary** (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/delehner/coding-agents/main/scripts/install.sh | bash
```

**Homebrew:**

```bash
brew tap delehner/tap
brew install ca
```

**From source:**

```bash
cargo install ca
```

**Verify:**

```bash
ca --version
ca --help
```

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| `git` | Yes | `brew install git` |
| `docker` | Yes | [docker.com](https://docker.com) |
| `devcontainer` | Yes | `npm install -g @devcontainers/cli` |
| `gh` | Yes | `brew install gh` |
| `claude` or `gemini` | Yes (one) | `npm install -g @anthropic-ai/claude-code` or `npm install -g @google/gemini-cli` |

**Note:** `jq` and `node` are no longer required to run the pipeline — the Rust binary handles JSON natively.

## Quick Start

### 1. Authenticate

```bash
claude            # login with Claude Max
gh auth login     # login to GitHub
```

### 2. Generate context for your repo

```bash
ca generate context \
  --repo https://github.com/you/your-repo \
  --output ./contexts/your-repo
```

### 3. Generate PRDs and a manifest

```bash
ca generate prd \
  --output ./prds/your-project \
  --manifest ./manifests/your-project.json \
  --repo https://github.com/you/your-repo \
  --context ./contexts/your-repo
```

### 4. Run the pipeline

```bash
ca orchestrate --manifest ./manifests/your-project.json
```

## Commands

| Command | Description |
|---------|-------------|
| `ca orchestrate --manifest <path>` | Run all orders/PRDs from a manifest |
| `ca pipeline --prd <path> --repo <url>` | Run a single PRD against one repo |
| `ca run --agent <name> --workdir <path> --prd <path>` | Run a single agent (Ralph Loop) |
| `ca generate prd --output <dir> --manifest <path> --repo <url> --context <path>` | Generate PRDs interactively |
| `ca generate context --repo <url> --output <dir>` | Generate context skills from a repo |
| `ca monitor [--agent <name>]` | Tail agent logs in real-time |
| `ca logs <file.jsonl>` | Re-format raw log files |
| `ca install skills [--project <path>]` | Install Cursor skills as symlinks |
| `ca update` | Self-update to latest version |

## Manifest Structure

```json
{
  "name": "My Project",
  "orders": [
    {
      "name": "1 - Foundation",
      "prds": [
        {
          "prd": "./prds/01-setup.md",
          "agents": ["architect", "designer"],
          "repositories": [
            {
              "url": "https://github.com/org/repo",
              "branch": "main",
              "context": "./contexts/repo",
              "agents": ["developer", "tester", "reviewer"]
            }
          ]
        }
      ]
    }
  ]
}
```

- **Orders** execute sequentially (merge PRs before next order)
- **PRDs within an order** execute in parallel
- **Same-repo PRDs** auto-serialize into stacking waves
- **Per-unit agents** combine: PRD agents first, then repo agents

## Agent Pipeline

| Order | Agent | Blocking | Produces |
|-------|-------|----------|----------|
| 1 | Architect | Yes | `architecture.md` |
| 2 | Designer | No | `design.md` |
| 3 | Migration | No | `migration-plan.md` |
| 4 | Developer | Yes | Working code + commits |
| 5 | Accessibility | No | `accessibility-report.md` |
| 6 | Tester | Yes | `test-report.md` |
| 7 | Performance | No | `performance-report.md` |
| 8 | SecOps | Yes | `security-report.md` |
| 9 | Dependency | No | `dependency-report.md` |
| 10 | Infrastructure | Yes | `infrastructure.md` |
| 11 | DevOps | Yes | `devops.md` |
| 12 | Rollback | No | `rollback-plan.md` |
| 13 | Documentation | No | `documentation-summary.md` |
| 14 | Reviewer | Yes | `pr-description.md` |

Blocking agents halt the pipeline on failure. Non-blocking agents log a warning and continue.

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `claude` | `claude` or `gemini` |
| `CLAUDE_MODEL` | `sonnet` | Default Claude model |
| `GEMINI_MODEL` | `gemini-2.5-pro` | Default Gemini model |
| `PIPELINE_MAX_ITERATIONS` | `10` | Max Ralph Loop iterations per agent |
| `PIPELINE_MAX_PARALLEL` | `4` | Max concurrent pipelines |
| `PIPELINE_WORK_DIR` | `/tmp/coding-agents-work` | Clone directory |
| `EVIDENCE_AGENTS` | `tester,performance,...` | Agents whose reports become PR comments |
| `INTERACTIVE` | `false` | Pause between agents/iterations |

Per-agent overrides: `ARCHITECT_MODEL`, `DEVELOPER_MAX_ITERATIONS`, etc.

## Project Structure

```
├── Cargo.toml                — Rust project manifest
├── src/                      — Rust source (~4,400 lines)
│   ├── main.rs               — entry point, CLI dispatch
│   ├── cli.rs                — clap subcommands and flags
│   ├── config.rs             — .env loading, per-agent overrides
│   ├── pipeline/             — orchestrator, runner, agent loop, devcontainer
│   ├── provider/             — Claude + Gemini CLI abstraction
│   ├── git/                  — clone, branch, rebase, PR creation
│   ├── manifest/             — manifest JSON parsing (serde)
│   ├── prd/                  — PRD metadata extraction
│   ├── context/              — context skill assembly
│   └── logging/              — JSONL formatting, log tailing
├── agents/                   — Agent prompt markdown files
├── templates/                — PRD, manifest, context templates
├── skills/                   — Cursor-compatible skills
├── contexts/                 — Per-repo context directories
├── manifests/                — Manifest JSON files
├── scripts/install.sh        — Binary download installer
├── .devcontainer/            — Dev Container configs (72 lines of shell — only remaining shell)
├── .github/workflows/        — CI + release automation
└── docs/                     — Architecture documentation
```

## Monitoring

```bash
# Tail all agent logs
ca monitor

# Filter by agent
ca monitor --agent developer

# List resumable sessions
ca monitor --sessions

# Re-format a raw log file
ca logs ./logs/developer_iteration_1.jsonl

# Resume a session interactively
claude --resume <session-id>
```

## Development

```bash
# Build
cargo build

# Run tests
cargo test

# Lint
cargo clippy

# Format
cargo fmt

# Release build (1.4 MB stripped binary)
cargo build --release
```

## Documentation

See `docs/` for detailed guides:

- [Pipeline Overview](docs/pipeline-overview.md) — end-to-end flow, agent responsibilities, CLI reference
- [Ralph Loop](docs/ralph-loop.md) — iteration mechanism, prompt assembly, completion detection
- [Adding Agents](docs/adding-agents.md) — step-by-step guide for new agents
- [Project Structure](docs/project-structure.md) — directory map, component relationships
- [Prerequisites](docs/prerequisites.md) — required tools, auth setup
- [MCP Integrations](docs/mcp-integrations.md) — Notion, Figma, Slack, Jira

## License

MIT
