# Coding Agents Pipeline

This repository contains a generic AI agent pipeline that turns PRDs into Pull Requests using Claude Code, Ralph Loops, and Dev Containers.

## Project Structure

- `pipeline/orchestrator.sh` — Manifest orchestrator: reads a JSON manifest, executes orders sequentially, PRDs in parallel
- `pipeline/run-pipeline.sh` — Single PRD × single repo: clones, branches, starts Dev Container, runs agents, creates PR
- `pipeline/run-agent.sh` — Ralph Loop wrapper for one agent
- `pipeline/lib/` — Shared utilities (prd-parser.sh, progress.sh, git-utils.sh, validation.sh)
- `agents/` — Agent prompt files (architect, designer, developer, tester, secops, infrastructure, devops, reviewer)
- `manifests/` — Manifest JSON files defining orders, PRDs, repos, and contexts
- `contexts/` — Per-repository context files (injected as ephemeral CLAUDE.md, never committed to target repos)
- `templates/` — PRD template, manifest template, project context template
- `skills/` — Cursor-compatible agent skills
- `.devcontainer/` — Dev Container configs (one for editing this repo, one for agent execution)
- `config/` — Settings templates

## Key Concepts

- **Manifest**: A JSON file that defines the full execution plan. Contains ordered batches ("orders") of PRDs, each PRD targeting one or more repos with per-repo context files, branches, and optional agent lists.
- **Orders**: Execute sequentially — order N finishes and PRs are merged before order N+1 starts.
- **PRDs in an order**: Execute in parallel by default.
- **Per-repo context**: Each repository has its own context file in `contexts/`. The context is injected as an ephemeral `CLAUDE.md` into the working directory and never committed.
- **Ralph Loop**: Iterative Claude Code sessions. Each iteration gets a fresh context window. Progress is tracked via `.agent-progress/` files.
- **Dev Containers**: Agents run inside isolated containers by default. The pipeline manages the container lifecycle automatically.
- **Working Branch**: Each PRD declares a `**Working Branch**` in its metadata (e.g. `delehner/01-foundation`). The pipeline uses it as the feature branch name. Falls back to auto-generation if not specified.
- **PR Evidence**: After PR creation, agent reports (tester, secops, infrastructure, devops by default) are posted as PR comments. Configurable via `EVIDENCE_AGENTS` env var or `--evidence-agents` flag.
- **Per-unit agent selection**: Agents can be specified at the PRD level (`orders[].prds[].agents`) and/or repo level (`orders[].prds[].repositories[].agents`) in the manifest. They combine: PRD agents run first, then repo agents. If neither is specified, the global `--agents` flag (or built-in default) applies.
- **Empty repo handling**: When the target repo has no branches (virgin repo), the pipeline seeds `main` with an initial commit and works directly on it — no feature branch, no PR. The finished `main` is pushed to origin at the end.
- **Pipeline Order**: Architect → Designer → Developer → Tester → SecOps → Infrastructure → DevOps → Reviewer → PR (with evidence comments)

## When Modifying Agent Prompts

- Keep prompts focused on the agent's specific responsibility
- Always include clear completion criteria
- Reference `_base-system.md` for shared conventions — don't duplicate them
- Test prompt changes by running a single agent: `./pipeline/run-agent.sh --agent <name> --workdir <path> --prd <path>`

## When Modifying Pipeline Scripts

- Scripts use bash with `set -euo pipefail`
- Must work with macOS `/bin/bash` 3.2 — no associative arrays (`declare -A`) or `wait -n`
- Shared utilities live in `pipeline/lib/`
- The `log()` function is defined in orchestrator.sh, run-pipeline.sh, and run-agent.sh
- Test changes with `--skip-pr --no-devcontainer` flags and a test repository

## When Adding a New Agent

1. Create `agents/<name>/prompt.md` following existing agent structure
2. Add the agent name to the default `AGENTS` variable in `run-pipeline.sh` and `orchestrator.sh`
3. Define its position in the pipeline sequence (which agents come before/after)
4. Add corresponding Cursor skill in `skills/<name>/SKILL.md` if appropriate
5. Update documentation (see below)

## Documentation Requirements

The `docs/` directory contains Mermaid diagrams and reference docs. **Always update docs when changing the repo.** See `docs/project-structure.md` for the file reference table.

Key docs:
- `docs/pipeline-overview.md` — end-to-end flow, agent responsibilities, CLI reference
- `docs/ralph-loop.md` — iteration mechanism, prompt assembly, completion detection
- `docs/adding-agents.md` — step-by-step guide for new agents
- `docs/project-structure.md` — directory map, component relationships, file reference
- `docs/mcp-integrations.md` — MCP server setup and configuration
- `docs/prerequisites.md` — required tools, auth methods, dev container setup
