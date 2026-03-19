# Wisp

A single Rust binary (`wisp`) that turns PRDs into Pull Requests using AI coding agents (Claude Code or Gemini CLI), Ralph Loops, and Dev Containers.

## Project Structure

- `Cargo.toml` — Rust project manifest (dependencies: clap, tokio, serde, anyhow, tracing, etc.)
- `src/main.rs` — Entry point, CLI dispatch, generator commands, install skills
- `src/cli.rs` — Clap derive structs for all subcommands and flags
- `src/config.rs` — `.env` loading, env var resolution, per-agent model/iteration overrides
- `src/manifest/mod.rs` — Manifest, Order, PrdEntry, Repository structs (serde deserialization)
- `src/prd/mod.rs` — PRD struct, markdown metadata extraction (title, status, branch, priority)
- `src/provider/` — AI provider abstraction (Provider trait, claude.rs, gemini.rs)
- `src/pipeline/mod.rs` — Default agent ordering, blocking/non-blocking classification
- `src/pipeline/orchestrator.rs` — Manifest dispatch, order sequencing, wave stacking, parallel execution (tokio Semaphore + JoinSet)
- `src/pipeline/runner.rs` — Single PRD x repo pipeline (clone, branch, devcontainer, agent sequence, PR)
- `src/pipeline/agent.rs` — Ralph Loop (prompt assembly, completion detection, interactive mode)
- `src/pipeline/devcontainer.rs` — Dev Container lifecycle with RAII cleanup (Drop impl)
- `src/git/mod.rs` — Clone, branch, rebase, push, git excludes
- `src/git/pr.rs` — `gh pr create`, evidence comments
- `src/context/mod.rs` — Skill assembly in canonical order, YAML frontmatter stripping
- `src/logging/mod.rs` — Tracing subscriber initialization
- `src/logging/formatter.rs` — JSONL stream formatting (Claude + Gemini event types)
- `src/logging/monitor.rs` — Real-time log tailing (notify-based), session listing
- `src/utils.rs` — Async exec helpers, command existence check, repo name extraction, slugify
- `agents/` — Agent prompt files (`_base-system.md` + per-agent `prompt.md`)
- `templates/` — PRD, manifest, and context templates
- `skills/` — Cursor-compatible agent skills
- `contexts/` — Per-repository context skill directories
- `manifests/` — Manifest JSON files
- `scripts/install.sh` — Binary download installer (the only non-devcontainer shell script)
- `.devcontainer/` — Dev Container configs (72 lines of shell for firewall/setup hooks)
- `.github/workflows/` — CI (build/test/clippy/fmt) and release (cross-compile + GitHub Releases)
- `config/` — AI CLI settings templates
- `.mcp.json` — MCP server configuration (GitHub, Notion, Figma, Slack)

## Key Concepts

- **Manifest**: JSON file defining orders, PRDs, repos, contexts, and agent lists. Parsed with serde_json.
- **Orders**: Execute sequentially. PRDs within an order execute in parallel (tokio JoinSet + Semaphore).
- **Stacked branches**: Same-repo PRDs auto-serialize into waves. Each wave branches from the previous feature branch.
- **AI Provider**: Supports Claude Code (`claude`) and Gemini CLI (`gemini`). Provider trait in `src/provider/mod.rs`.
- **Per-repo context**: Directory of markdown skill files assembled into ephemeral `CLAUDE.md` or `GEMINI.md`.
- **Ralph Loop**: Iterative agent execution in `src/pipeline/agent.rs`. Progress tracked via `.agent-progress/` files.
- **Dev Containers**: RAII lifecycle in `src/pipeline/devcontainer.rs`. Drop impl stops/removes containers.
- **Pipeline Order**: Architect → Designer → Migration → Developer → Accessibility → Tester → Performance → SecOps → Dependency → Infrastructure → DevOps → Rollback → Documentation → Reviewer → Rebase → PR

## When Modifying Agent Prompts

- Keep prompts focused on the agent's specific responsibility
- Always include clear completion criteria
- Reference `_base-system.md` for shared conventions — don't duplicate them
- Test prompt changes: `wisp run --agent <name> --workdir <path> --prd <path>`

## When Modifying Rust Code

- Run `cargo test` before committing
- Run `cargo clippy` to catch common issues
- Run `cargo fmt` to maintain consistent formatting
- The binary must cross-compile for macOS (arm64/x86_64) and Linux (arm64/x86_64)
- Config fields in `src/config.rs` must match `.env.example` variables

## When Adding a New Agent

1. Create `agents/<name>/prompt.md` following existing agent structure
2. Add the agent name to `DEFAULT_AGENTS` in `src/pipeline/mod.rs`
3. If non-blocking, add to `NON_BLOCKING_AGENTS` in `src/pipeline/mod.rs`
4. Add `AgentModelOverrides` and `AgentIterationOverrides` fields in `src/config.rs`
5. Add corresponding Cursor skill in `skills/<name>/SKILL.md` if appropriate
6. Update documentation (see below)

## Documentation Requirements

The `docs/` directory contains Mermaid diagrams and reference docs. **Always update docs when changing the repo.** See `docs/project-structure.md` for the file reference table.

Key docs:
- `docs/pipeline-overview.md` — end-to-end flow, agent responsibilities, CLI reference
- `docs/ralph-loop.md` — iteration mechanism, prompt assembly, completion detection
- `docs/adding-agents.md` — step-by-step guide for new agents
- `docs/project-structure.md` — directory map, component relationships, file reference
- `docs/mcp-integrations.md` — MCP server setup and configuration
- `docs/prerequisites.md` — required tools, auth methods, dev container setup
