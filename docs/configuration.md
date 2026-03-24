# Configuration Guide

How to configure `.env` and the installation root when using Homebrew, curl, or `cargo install`.

## How Wisp Finds Your Config

Wisp looks for a **root directory** containing:

- `agents/` — Agent prompt definitions
- `templates/` — PRD, manifest, and context templates
- `.env` — Your configuration (API keys, model overrides, etc.)

**Resolution order:**

1. Walk up from the executable — if `agents/` and `templates/` exist nearby (e.g. when running from repo root), use that
2. `WISP_ROOT_DIR` environment variable — if set, use that path
3. `~/.wisp` — default fallback

When you install via **Homebrew** or **curl**, the binary is placed in `/opt/homebrew/bin` or `/usr/local/bin`. The executable has no `agents/` or `templates/` next to it, so wisp falls back to `WISP_ROOT_DIR` or `~/.wisp`.

---

## Setup for Homebrew / curl / cargo install

### Option A: Clone the repo (recommended)

This gives you the full wisp directory: agents, templates, and `.env.example`.

```bash
# 1. Clone the repo
git clone https://github.com/delehner/wisp.git ~/wisp
cd ~/wisp

# 2. Create your .env from the template
cp .env.example .env

# 3. Edit .env with your values (see below)
# $EDITOR .env

# 4. Set WISP_ROOT_DIR so wisp finds this directory
# Add to ~/.zshrc or ~/.bashrc:
echo 'export WISP_ROOT_DIR="$HOME/wisp"' >> ~/.zshrc
source ~/.zshrc
```

**Optional:** Use `~/.wisp` instead of `~/wisp` so you don’t need `WISP_ROOT_DIR`:

```bash
git clone https://github.com/delehner/wisp.git ~/.wisp
cd ~/.wisp
cp .env.example .env
# Edit .env
```

### Option B: Use `wisp install agents` (quickest)

This downloads only the agent prompt files without cloning the full repo. Useful after a Homebrew or curl install when you just need agents.

```bash
# 1. Download agent prompts to ~/.wisp/agents/
wisp install agents

# 2. Create ~/.wisp/.env from the template (download once)
curl -fsSL https://raw.githubusercontent.com/delehner/wisp/main/.env.example -o ~/.wisp/.env

# 3. Edit ~/.wisp/.env with your values
$EDITOR ~/.wisp/.env
```

Wisp automatically finds `~/.wisp/` as the fallback root, so no `WISP_ROOT_DIR` is required.

Re-run `wisp install agents` after upgrading wisp to keep agent prompts in sync with the binary. Use `--force` to overwrite existing files.

### Option C: Use an existing project directory

If you already have a wisp project (e.g. with manifests and PRDs):

```bash
# Clone wisp into your project
git clone https://github.com/delehner/wisp.git /tmp/wisp-clone
cp -r /tmp/wisp-clone/agents /tmp/wisp-clone/templates /path/to/your/project/
cp /tmp/wisp-clone/.env.example /path/to/your/project/.env

# Set WISP_ROOT_DIR to your project
export WISP_ROOT_DIR="/path/to/your/project"
```

---

## Configuring `.env`

Copy `.env.example` to `.env` and adjust as needed.

### Minimum required

| Variable | When to set | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Using Claude API (pay-per-token) | `sk-ant-...` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Max + Dev Containers | From `claude setup-token` |
| `GEMINI_API_KEY` | Using Gemini | From aistudio.google.com |
| `GITHUB_TOKEN` | If `gh auth login` not used | `ghp_...` |

**Claude Max users:** Leave `ANTHROPIC_API_KEY` blank. Run `claude` once to log in. For Dev Containers, prefer `CLAUDE_CODE_OAUTH_TOKEN`.

**Gemini users:** Run `gemini auth login` or set `GEMINI_API_KEY`.

### Common overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `claude` | `claude` or `gemini` |
| `CLAUDE_MODEL` | `sonnet` | Default Claude model |
| `GEMINI_MODEL` | `gemini-2.5-pro` | Default Gemini model |
| `PIPELINE_MAX_ITERATIONS` | `2` | Default max Ralph Loop iterations per agent (when manifest has no `max_iterations`) |
| `PIPELINE_WORK_DIR` | `/tmp/wisp-work` | Where repos are cloned |
| `LOG_DIR` | `./logs` | Root log directory; each pipeline run writes under a child folder `{repo}__{prd-slug}__{nanos}/` (see [ralph-loop.md](./ralph-loop.md#log-files-per-pipeline-run)) |

### Manifest iteration fields (`wisp orchestrate`)

Manifest JSON may include:

- **`max_iterations`** (number) — default Ralph cap for that manifest’s pipelines  
- **`agent_max_iterations`** (object) — optional per-agent caps, same keys as in `.env.example` (e.g. `"developer": 5`)  

If omitted, orchestration falls back to `PIPELINE_MAX_ITERATIONS` and `wisp orchestrate --max-iterations` (both loaded into config) plus env per-agent vars. If the manifest **sets** `max_iterations`, that value is the pipeline default for orchestrate and overrides config for that manifest. After **`wisp generate prd`** completes, Wisp writes both fields into the generated manifest from your current config so you can commit tuned values with the project.

### Full reference

See [`.env.example`](../.env.example) in the repo root for all variables and comments.

---

## Verify

```bash
# Check wisp finds your root
wisp --help

# If using WISP_ROOT_DIR, ensure it's set
echo $WISP_ROOT_DIR

# Ensure .env exists in that directory
ls -la $WISP_ROOT_DIR/.env
# or
ls -la ~/.wisp/.env
```

---

## Summary

| Install method | Root directory | Action |
|----------------|----------------|--------|
| Homebrew | `WISP_ROOT_DIR` or `~/.wisp` | `wisp install agents`, create `~/.wisp/.env` |
| curl \| bash | Same | Same |
| cargo install | Same | Same |
| From repo (dev) | Repo root | `.env` in repo root |
