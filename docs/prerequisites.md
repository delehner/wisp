# Prerequisites

Everything you need to run the Coding Agents pipeline.

## Required

| Tool | Purpose | Install |
|------|---------|---------|
| **Claude Code CLI** | AI engine that powers every agent | `npm install -g @anthropic-ai/claude-code` |
| **Node.js >= 18** | Runtime for Claude Code CLI | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Git** | Repository cloning, branching, committing | `brew install git` (macOS ships with it) |
| **Bash** | Pipeline scripts (macOS built-in `/bin/bash` 3.2+ works fine) | Pre-installed on macOS and Linux |
| **Docker Desktop** | Dev Containers run agents in isolated containers | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Dev Containers CLI** | Starts and manages agent containers programmatically | `npm install -g @devcontainers/cli` |
| **GitHub CLI (`gh`)** | PR creation, repo management | `brew install gh` |

> Docker and the Dev Containers CLI are required because agents run inside
> containers by default. Pass `--no-devcontainer` to skip this and run directly
> on the host.

## Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **jq** | JSON parsing in pipeline scripts | `brew install jq` |
| **Homebrew** | Package manager for macOS (installs everything above) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |

## Authentication

You need **one** of the following for Claude Code:

| Method | Who it's for | Setup |
|--------|-------------|-------|
| **Claude Max subscription** | Individual users ($100-200/month flat rate) | Run `claude` once to login via browser. Leave `ANTHROPIC_API_KEY` blank. For Dev Containers, set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` (generate with `claude setup-token`) if browser login does not propagate. |
| **Anthropic API key** | Pay-per-token or organization usage | Get a key at [console.anthropic.com](https://console.anthropic.com), set `ANTHROPIC_API_KEY` in `.env`. |

For GitHub access you need **one** of:

| Method | Setup |
|--------|-------|
| **GitHub CLI auth** (recommended) | `brew install gh && gh auth login` |
| **Personal Access Token** | Create at [github.com/settings/tokens](https://github.com/settings/tokens), set `GITHUB_TOKEN` in `.env` |

## Optional MCP Integrations

These are external services the agents can connect to. None are required.

| MCP | Purpose | Setup |
|-----|---------|-------|
| **GitHub** | Repo browsing, issue tracking | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` |
| **Notion** | Read specs and docs from Notion | `claude mcp add --transport http notion https://mcp.notion.com/mcp` |
| **Figma** | Extract design tokens, components, layouts (Designer agent) | `claude mcp add --transport http figma https://mcp.figma.com/mcp` — requires `FIGMA_ACCESS_TOKEN` |
| **Jira** | Ticket tracking and status updates | See `docs/mcp-integrations.md` |

## Quick Install (macOS)

```bash
# Package manager
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Core tools
brew install node git gh jq
brew install --cask docker          # Docker Desktop

# CLI tools
npm install -g @anthropic-ai/claude-code @devcontainers/cli

# Auth
claude                              # login with Max subscription
gh auth login                       # login to GitHub
```

## Quick Verify

```bash
# Required
node --version          # >= 18
git --version           # any recent version
claude --version        # any version
docker --version        # any version
devcontainer --version  # any version
gh --version            # any version

# Check Docker is running
docker info > /dev/null 2>&1 && echo "Docker is running" || echo "Start Docker Desktop"
```

## How Dev Containers Work in the Pipeline

When you run the pipeline, each PRD x repo combination gets its own Dev Container:

```
Host                          Container
─────────────────────────────────────────────
orchestrator.sh               
  └─ run-pipeline.sh          
       ├─ git clone           
       ├─ devcontainer up ──→ Container starts
       │                      │
       ├─ devcontainer exec ──→ run-agent.sh (architect)
       │                        └─ claude -p (sandboxed)
       ├─ devcontainer exec ──→ run-agent.sh (designer)
       ├─ devcontainer exec ──→ run-agent.sh (developer)
       ├─ devcontainer exec ──→ run-agent.sh (tester)
       ├─ devcontainer exec ──→ run-agent.sh (secops)
       ├─ devcontainer exec ──→ run-agent.sh (infrastructure)
       ├─ devcontainer exec ──→ run-agent.sh (devops)
       ├─ devcontainer exec ──→ run-agent.sh (reviewer)
       │                      │
       ├─ docker stop ───────→ Container removed
       └─ gh pr create        
```

The container mounts your Claude auth (`~/.claude`), GitHub auth (`~/.config/gh`),
and the target repository. Pipeline scripts and agent prompts are copied into
the workspace so they're accessible inside the container.

If Claude Max browser login is not detected inside the container, prefer
`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) for container runs.

Agent commits use your host Git identity. Ensure `git config --global user.name`
and `git config --global user.email` are set on the host before running the pipeline.
