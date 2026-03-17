# Coding Agents Pipeline

A generic, extensible AI agent pipeline that turns PRDs into Pull Requests using Claude Code with Ralph Loops and Dev Containers.

## How It Works

```
Manifest → Orders (sequential) → PRDs (parallel) → Repos (per-repo context) → PRs
```

A **manifest** JSON defines the execution plan: a sequence of **orders**, each containing **PRDs** that run in parallel. Each PRD targets one or more **repositories**, each with its own branch and context skills. Every PRD x repo combination runs as an independent pipeline inside a Dev Container, with each agent operating in a Ralph Loop.

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

Key concepts:
- **Orders** run sequentially (merge PRs from order 1 before order 2 starts)
- **PRDs** within an order run in parallel. When multiple PRDs target the same repo, they are automatically serialized with **stacked branches** to prevent merge conflicts
- Each **repository** has its own context directory (or file), branch, and URL
- Context skills are assembled into ephemeral `CLAUDE.md` — never committed to the target repo
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
  --context ./contexts/repo
```

### Monitoring & Interaction

```bash
# Verbose logs: see agent thinking, tool calls, and results in real-time
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --verbose-logs

# Interactive mode: pause between agents and iterations for review
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --interactive

# Both: full visibility + control
./pipeline/orchestrator.sh --manifest ./manifests/my-project.json --verbose-logs --interactive

# Monitor logs from another terminal while the pipeline runs
./pipeline/monitor.sh                           # all logs
./pipeline/monitor.sh --agent developer         # specific agent
./pipeline/monitor.sh --sessions                # list resumable sessions

# Resume an agent session interactively (from session ID)
claude --resume <session-id>
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
│   ├── generate-context.sh      # Context skill generator (analyzes repos)
│   ├── generate-prd.sh          # PRD and manifest generator (from project briefs)
│   ├── monitor.sh               # Real-time log monitor (tail, filter, session list)
│   └── lib/
│       ├── prd-parser.sh        # Parse PRD metadata (status, title)
│       ├── git-utils.sh         # Branch management, rebase, and PR creation
│       ├── progress.sh          # Progress tracking between iterations
│       ├── validation.sh        # Completion criteria checks
│       ├── context.sh           # Context skill assembly
│       └── log-formatter.sh     # Stream-json → human-readable log formatter
├── agents/
│   ├── _base-system.md          # Shared base instructions for all agents
│   ├── architect/prompt.md
│   ├── designer/prompt.md
│   ├── developer/prompt.md
│   ├── tester/prompt.md
│   ├── secops/prompt.md
│   ├── infrastructure/prompt.md
│   ├── devops/prompt.md
│   ├── reviewer/prompt.md
│   ├── context-generator/prompt.md
│   └── prd-generator/prompt.md
├── manifests/                   # Manifest JSON files (orders + PRDs + repos + contexts)
│   └── portfolio.json
├── prds/                        # Product Requirements Documents
├── contexts/                    # Per-repo context skill directories
│   └── <repo-name>/            # Skills: overview.md, architecture.md, conventions.md, ...
├── templates/
│   ├── manifest.json            # Manifest template
│   ├── prd.md                   # PRD template
│   ├── brief.md                 # Project brief template (input for PRD generation)
│   ├── project-context.md       # Legacy single-file context template
│   └── context-skill.md         # Context skill template (directory-based)
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

1. Generate context skills for your repo: `./pipeline/generate-context.sh --repo <path-or-url> --output ./contexts/my-repo`
2. Review and refine the generated skills in `contexts/my-repo/`
3. Generate PRDs and a manifest — the script opens your editor so you can describe what you want to build:
   ```bash
   ./pipeline/generate-prd.sh \
     --output ./prds/my-app \
     --manifest ./manifests/my-app.json \
     --repo https://github.com/org/my-repo --context ./contexts/my-repo
   ```
4. Review the generated PRDs and manifest, then run: `./pipeline/orchestrator.sh --manifest ./manifests/my-app.json`

> You can also pass `--brief <file>` to skip the editor, or write PRDs manually using `templates/prd.md`.

### For Company Projects

Context skills are injected as ephemeral `CLAUDE.md` that **never gets committed** to target repos.

1. Generate context skills for each repo: `./pipeline/generate-context.sh --repo <url> --output ./contexts/my-repo`
2. Review and customize the skills — add company-specific conventions, security policies, etc.
3. Generate PRDs and manifest — the script opens your editor to describe the work:
   ```bash
   ./pipeline/generate-prd.sh \
     --output ./prds/platform \
     --manifest ./manifests/platform.json \
     --repo https://github.com/org/api --context ./contexts/api \
     --repo https://github.com/org/web --context ./contexts/web
   ```
4. Review, adjust, and run. Connect Jira/Notion MCPs for ticket tracking

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
