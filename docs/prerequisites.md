# Prerequisites

Everything you need to run the Wisp pipeline.

## Required

| Tool | Purpose | Install |
|------|---------|---------|
| **AI CLI** (one of) | AI engine that powers every agent | Claude Code: `npm install -g @anthropic-ai/claude-code` — or — Gemini CLI: `npm install -g @google/gemini-cli` |
| **Git** | Repository cloning, branching, committing | `brew install git` (macOS ships with it) |
| **Docker Desktop** | Dev Containers run agents in isolated containers | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Dev Containers CLI** | Starts and manages agent containers programmatically | `npm install -g @devcontainers/cli` |
| **GitHub CLI (`gh`)** | PR creation, repo management | `brew install gh` |

> Docker and the Dev Containers CLI are required because agents always run inside
> containers. The `wisp` CLI enforces this; `--no-devcontainer` is only available
> when calling the pipeline directly for debugging.

## Installing the `wisp` CLI

The `wisp` binary is a single static executable. Choose one of:

| Method | Use case | Command |
|--------|----------|---------|
| **curl \| bash** | Quick install, pre-built binary | `curl -fsSL https://raw.githubusercontent.com/delehner/wisp/main/scripts/install.sh \| bash` |
| **Homebrew** | macOS/Linux package manager | `brew tap delehner/tap && brew install wisp` |
| **Cargo** | Build from source | `cargo install wisp` |

The curl installer downloads a pre-built binary for your platform from GitHub Releases. No `jq`, `node`, or other runtime dependencies are required — `wisp` is self-contained.

> **Homebrew and curl installs:** The binary needs `agents/`, `templates/`, and `.env`. Run `wisp install agents` to download agent prompts to `~/.wisp/agents/` without cloning the full repo. See [Configuration Guide](configuration.md).

### Optional: Build from Source

If you want to modify the pipeline or build from source:

| Tool | Purpose | Install |
|------|---------|---------|
| **Rust toolchain** | Compile `wisp` from source | [rustup.rs](https://rustup.rs) |

Then run `cargo build --release` in the repo root, or `cargo install wisp` to install globally.

## Optional: VS Code Extension

If you use VS Code or Cursor, you can run Wisp commands directly from the Command Palette without switching to a terminal. The extension is a thin launcher on top of the CLI — you still need the `wisp` binary installed first.

See [Installing the Wisp AI VS Code Extension](vscode-install.md) for installation options (Marketplace, VSIX, or build from source).

## Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **Homebrew** | Package manager for macOS (installs everything above) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |

## Authentication

You need **one** AI provider configured:

### Claude Code

| Method | Who it's for | Setup |
|--------|-------------|-------|
| **Claude Max subscription** | Individual users ($100-200/month flat rate) | Run `claude` once to login via browser. Leave `ANTHROPIC_API_KEY` blank. For Dev Containers, set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` (generate with `claude setup-token`) if browser login does not propagate. |
| **Anthropic API key** | Pay-per-token or organization usage | Get a key at [console.anthropic.com](https://console.anthropic.com), set `ANTHROPIC_API_KEY` in `.env`. |

#### Dev Containers (Wisp agent container)

If JSONL logs show **Not logged in · Please run /login**, Claude Code inside the container has no credentials.

1. Put **`ANTHROPIC_API_KEY`** and/or **`CLAUDE_CODE_OAUTH_TOKEN`** in the `.env` file that **Wisp loads**: for `cargo run` / `./target/release/wisp` from a clone, that is typically `.env` at the repo root next to `agents/` (see `find_root_dir` in the code); for installed binaries, often `~/.wisp/.env`. `dotenvy` loads that file into the `wisp` process; the child `devcontainer` CLI inherits the same environment so `${localEnv:...}` in `.devcontainer/agent/devcontainer.json` resolves correctly.
2. **Subscription / Max:** run `claude setup-token`, add the token to `.env` as `CLAUDE_CODE_OAUTH_TOKEN`. Browser-only login on the host may not be enough for headless runs in the container.
3. If the agent image was built when variables were **unset**, remove the old container or trigger a fresh **`devcontainer up`** so `containerEnv` is applied with current values.

### Gemini CLI (Alternative)

| Method | Setup |
|--------|-------|
| **Browser login** | Run `gemini auth login` to authenticate via browser |
| **API key** | Set `GEMINI_API_KEY` in `.env` |

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
brew install git gh
brew install --cask docker          # Docker Desktop

# CLI tools (install at least one AI CLI)
npm install -g @anthropic-ai/claude-code @devcontainers/cli
# Or use Gemini: npm install -g @google/gemini-cli

# Auth (for your chosen AI provider)
claude                              # Claude: login with Max subscription
# Or: gemini auth login             # Gemini: browser login
gh auth login                       # login to GitHub

# Install the wisp CLI
brew tap delehner/tap && brew install wisp
# Or: curl -fsSL https://raw.githubusercontent.com/delehner/wisp/main/scripts/install.sh | bash
# Then: see docs/configuration.md for .env and WISP_ROOT_DIR setup
```

## Quick Verify

```bash
# Required
git --version           # any recent version
claude --version        # Claude Code (or gemini --version for Gemini CLI)
docker --version        # any version
devcontainer --version   # any version
gh --version            # any version
wisp help               # verify wisp is installed

# Check Docker is running
docker info > /dev/null 2>&1 && echo "Docker is running" || echo "Start Docker Desktop"
```

## How Dev Containers Work in the Pipeline

When you run the pipeline, each PRD × repo combination runs as its own pipeline. By default **each agent** gets a **fresh** Dev Container (`devcontainer up` → Ralph loop via `devcontainer exec` → stop/remove). Use `--reuse-devcontainer` or `WISP_REUSE_DEVCONTAINER=true` for one container for the whole agent sequence.

```
Host                          Container(s)
─────────────────────────────────────────────
wisp orchestrate
  └─ runner (per PRD×repo)
       ├─ git clone
       ├─ per agent (default):
       │    devcontainer up ──→ container N
       │    devcontainer exec ──→ claude/gemini (all iterations for that agent)
       │    docker stop/rm
       │    (repeat for next agent)
       └─ gh pr create
```

The container mounts your AI provider auth (`~/.claude` for Claude, `~/.config/gemini` for Gemini), GitHub auth (`~/.config/gh`), and the target repository. Pipeline code and agent prompts are copied into the workspace so they're accessible inside the container.

If Claude Max browser login is not detected inside the container, prefer `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) for container runs. For Gemini, use `GEMINI_API_KEY` in `.env` for reliable container auth.

Agent commits use your host Git identity. Ensure `git config --global user.name`
and `git config --global user.email` are set on the host before running the pipeline.
