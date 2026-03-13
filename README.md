# Coding Agents Pipeline

A generic, extensible AI agent pipeline that turns PRDs into Pull Requests using Claude Code with Ralph Loops and Dev Containers.

## How It Works

```
Manifest → Orders (sequential) → PRDs (parallel) → Repos (per-repo context) → PRs
```

A **manifest** JSON defines the execution plan: a sequence of **orders**, each containing **PRDs** that run in parallel. Each PRD targets one or more **repositories**, each with its own branch and context file. Every PRD x repo combination runs as an independent pipeline inside a Dev Container, with each agent operating in a Ralph Loop.

### Agent Roles

| Agent | Responsibility | Output |
|-------|---------------|--------|
| **Architect** | System design, tech decisions, file structure | `architecture.md`, dependency plan |
| **Designer** | UI/UX specs, component design, API contracts | Design specs, component hierarchy |
| **Developer** | Implementation based on architecture + design | Working code, commits |
| **Tester** | Test strategy, test implementation, coverage | Tests, coverage reports |
| **SecOps** | Security hardening and vulnerability remediation | Security report, security fixes |
| **Infrastructure** | Runtime/deployment infrastructure validation | Infrastructure plan, env contracts |
| **DevOps** | CI/CD and release readiness automation | DevOps runbook, pipeline updates |
| **Reviewer** | Code review, quality gates, final fixes | Review notes, fix commits |

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- [Docker Desktop](https://www.docker.com/) + [Dev Containers CLI](https://github.com/devcontainers/cli) — `npm install -g @devcontainers/cli`
- [GitHub CLI](https://cli.github.com/) — `brew install gh && gh auth login`
- **jq** — `brew install jq` (required for manifest parsing)
- **Claude Max subscription** or an **Anthropic API key**
- For Dev Container runs with Claude Max: generate `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token` and set it in `.env` if browser login is not detected in containers

> See **[docs/prerequisites.md](docs/prerequisites.md)** for the full setup guide.

### 1. Clone and Configure

```bash
git clone <this-repo>
cd coding-agents
cp .env.example .env
# Edit .env with your preferences
```

### 2. Set Up MCP Servers

```bash
# GitHub (required)
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# Notion (optional)
claude mcp add --transport http notion https://mcp.notion.com/mcp

# Figma (optional — used by the Designer agent)
claude mcp add --transport http figma https://mcp.figma.com/mcp

# Authenticate each server
claude  # then run /mcp inside the session
```

### 3. Create a Manifest

A manifest ties together PRDs, repositories, contexts, and execution order.

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
              "context": "./contexts/repo.md",
              "agents": ["developer", "tester", "reviewer"]
            }
          ]
        }
      ]
    }
  ]
}
```

Key concepts:
- **Orders** run sequentially (merge PRs from order 1 before order 2 starts)
- **PRDs** within an order run in parallel
- Each **repository** has its own context file (`CLAUDE.md`), branch, and URL
- Context files are injected as ephemeral `CLAUDE.md` — never committed to the target repo
- **Agents** can be specified per-PRD and/or per-repo — they combine (PRD-level first, then repo-level). Omit both to use the global default

See `templates/manifest.json` for the full template and `manifests/portfolio.json` for a real example.

### 4. Run the Pipeline

```bash
# Run a full manifest (orders execute sequentially, PRDs in parallel)
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json

# Run a specific order only
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --order 1

# Skip confirmation prompts between orders
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --auto

# Single PRD × single repo (legacy, no manifest needed)
./pipeline/run-pipeline.sh \
  --prd ./prds/my-feature.md \
  --repo https://github.com/org/repo \
  --context ./contexts/repo.md
```

### 5. Dev Containers (Default)

Agents run inside Dev Containers automatically — each PRD x repo gets its own isolated container. No extra setup beyond having Docker running.

```bash
# Skip containers for debugging
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --no-devcontainer
```

## Project Structure

```
coding-agents/
├── pipeline/
│   ├── orchestrator.sh          # Manifest orchestrator: orders → PRDs → repos → PRs
│   ├── run-pipeline.sh          # Single PRD × single repo pipeline
│   ├── run-agent.sh             # Ralph Loop wrapper for a single agent
│   └── lib/
│       ├── prd-parser.sh        # Parse PRD metadata (status, title)
│       ├── git-utils.sh         # Branch management and PR creation
│       ├── progress.sh          # Progress tracking between iterations
│       └── validation.sh        # Completion criteria checks
├── agents/
│   ├── _base-system.md          # Shared base instructions for all agents
│   ├── architect/prompt.md
│   ├── designer/prompt.md
│   ├── developer/prompt.md
│   ├── tester/prompt.md
│   ├── secops/prompt.md
│   ├── infrastructure/prompt.md
│   ├── devops/prompt.md
│   └── reviewer/prompt.md
├── manifests/                   # Manifest JSON files (orders + PRDs + repos + contexts)
│   └── portfolio.json
├── prds/                        # Product Requirements Documents
├── contexts/                    # Per-repo context files (injected as ephemeral CLAUDE.md)
├── templates/
│   ├── manifest.json            # Manifest template
│   ├── prd.md                   # PRD template
│   └── project-context.md       # Project context template
├── skills/                      # Cursor-compatible agent skills
├── .devcontainer/
│   ├── devcontainer.json        # Dev Container for editing this repo
│   ├── agent/                   # Dev Container for running agents (headless)
│   │   ├── devcontainer.json
│   │   └── Dockerfile
│   ├── Dockerfile
│   └── init-firewall.sh
├── docs/                        # Documentation with diagrams
├── config/
│   └── settings.json            # Claude Code settings template
├── .mcp.json                    # MCP server configuration
├── .env.example                 # Environment variables template
├── CLAUDE.md                    # Instructions for this repo
└── README.md
```

## Adapting to Your Project

### For Personal Projects

1. Create a context file in `contexts/` using `templates/project-context.md`
2. Write PRDs using `templates/prd.md`
3. Create a manifest in `manifests/` using `templates/manifest.json` — wire PRDs to repos and contexts
4. Run: `./pipeline/orchestrator.sh --manifest ./manifests/my-project.json`

### For Company Projects

Context files are injected as ephemeral `CLAUDE.md` that **never gets committed** to target repos.

1. Create context files in `contexts/` for each repo (e.g., `contexts/frontend.md`, `contexts/backend.md`)
2. Write PRDs — each PRD can target multiple repos (frontend + backend + shared library)
3. Create a manifest — each repo entry points to its own context file
4. Connect Jira/Notion MCPs for ticket tracking
5. Context files auto-update after each pipeline run

### Adding New Agents

Create a new directory under `agents/` with a `prompt.md` file following the existing format. Register the agent in `run-pipeline.sh`. See `docs/adding-agents.md` for a step-by-step guide.

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.
You can keep costs down with `CLAUDE_MODEL=sonnet` and optionally override specific agents (for example `REVIEWER_MODEL=opus`).

### MCP Servers

Edit `.mcp.json` to add or remove MCP server integrations. The file is committed to git so your team shares the same integrations.

## Cost Considerations

Ralph Loops consume API tokens per iteration. With a **Claude Max subscription**, usage is unlimited (subject to rate limits). With **API keys**, typical costs per agent per PRD:

| Agent | Iterations (avg) | Est. Cost (API) |
|-------|------------------|-----------------|
| Architect | 2-4 | $2-8 |
| Designer | 2-5 | $2-10 |
| Developer | 5-15 | $10-30 |
| Tester | 3-8 | $5-15 |
| SecOps | 2-5 | $3-8 |
| Infrastructure | 2-4 | $2-6 |
| DevOps | 2-4 | $2-6 |
| Reviewer | 2-5 | $2-10 |

## License

MIT
