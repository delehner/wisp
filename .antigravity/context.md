# Wisp — Project Context

## What Is Wisp?

Wisp is a single Rust binary that turns Product Requirements Documents (PRDs) into fully implemented Pull Requests by orchestrating AI coding agents in isolated Dev Containers.

- **Language**: Rust (2021 edition, async via tokio)
- **Binary name**: `wisp`
- **Repository**: https://github.com/delehner/wisp

## What It Does

1. Reads a manifest JSON file listing PRDs, target repositories, and agent sequences
2. Clones repos, creates feature branches, optionally starts Dev Containers
3. Runs a Ralph Loop — iterative AI agent execution — for each agent in the pipeline
4. Each agent reads/writes `.agent-progress/` files to track progress across iterations
5. After all agents complete, rebases the branch and opens a Pull Request via `gh pr create`

## Key File Map

| Path | Purpose |
|---|---|
| `src/main.rs` | Entry point, CLI dispatch |
| `src/cli.rs` | Clap CLI definitions for all subcommands and flags |
| `src/config.rs` | Environment variable loading and per-agent overrides |
| `src/utils.rs` | `exec_streaming()`, `exec_capture()`, `slugify()` |
| `src/manifest/mod.rs` | Manifest, Order, PrdEntry, Repository structs |
| `src/prd/mod.rs` | PRD struct and markdown metadata extraction |
| `src/provider/mod.rs` | Provider trait abstracting Claude/Gemini CLIs |
| `src/provider/claude.rs` | Claude Code CLI integration |
| `src/provider/gemini.rs` | Gemini CLI integration |
| `src/pipeline/mod.rs` | Agent list constants |
| `src/pipeline/orchestrator.rs` | Manifest dispatch, wave stacking, parallel execution |
| `src/pipeline/runner.rs` | Single PRD × repo pipeline execution |
| `src/pipeline/agent.rs` | Ralph Loop: iterative agent execution |
| `src/pipeline/devcontainer.rs` | Dev Container RAII lifecycle |
| `src/git/mod.rs` | Clone, branch, and rebase operations |
| `src/git/pr.rs` | Pull request creation and evidence posting |
| `src/context/mod.rs` | Context skill assembly into CLAUDE.md / GEMINI.md |
| `src/logging/` | Tracing setup, JSONL formatter, real-time monitor |
| `agents/` | Agent prompt files (base system + per-agent) |
| `contexts/` | Per-repo context skill directories |
| `manifests/` | Manifest JSON files |
| `skills/` | Cursor-compatible agent skills |
| `templates/` | PRD, manifest, and context skill templates |

## Pipeline Flow

14-agent sequence (in order):

| Agent | Role | Blocking? |
|---|---|---|
| Architect | System design, file structure, implementation plan | Yes |
| Designer | UI/UX specs, component designs | No |
| Migration | Database schema migrations | No |
| Developer | Code implementation | Yes |
| Accessibility | WCAG compliance | No |
| Tester | Test suite implementation | Yes |
| Performance | Performance analysis and optimization | No |
| SecOps | Security audit | Yes |
| Dependency | Dependency review and updates | No |
| Infrastructure | Infrastructure config (Docker, k8s, etc.) | Yes |
| DevOps | CI/CD pipeline configuration | Yes |
| Rollback | Rollback and recovery procedures | No |
| Documentation | Docs, README, changelogs | No |
| Reviewer | Final code review and PR summary | Yes |

Non-blocking agents: failures don't stop the pipeline.

## Key Abstractions

### Provider Trait
Abstracts over Claude Code and Gemini CLIs. Implement `build_run_args()` and `extract_session_id()` to add a new AI provider.

### Ralph Loop
The core execution loop. Each iteration: assemble prompt → run AI CLI → check for `## Status: COMPLETED` in `.agent-progress/<agent>.md` → loop until complete or max iterations reached.

### Wave Stacking
Multiple PRDs targeting the same repo are serialized into sequential waves to avoid merge conflicts.

### Filesystem Memory
Agents communicate across iterations and to subsequent agents via `.agent-progress/` files. The pipeline never deletes these during a run.
