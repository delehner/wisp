# Project Structure

Complete reference for the repository layout and how each component connects. The pipeline is a **Rust binary** (`wisp`) built with Cargo — no bash scripts.

## Directory Map

```mermaid
flowchart TD
    Root["wisp/"]

    Root --> Cargo["Cargo.toml\nRust project manifest"]
    Root --> Src["src/\nRust source code"]
    Root --> Scripts["scripts/\nBinary installer"]
    Root --> Agents["agents/\nAgent prompt definitions"]
    Root --> Manifests["manifests/\nExecution plans"]
    Root --> PRDs["prds/\nProduct Requirements Documents"]
    Root --> Contexts["contexts/\nPer-repo context skill directories"]
    Root --> Templates["templates/\nPRD, manifest, context templates"]
    Root --> Skills["skills/\nCursor-compatible skills"]
    Root --> DevC[".devcontainer/\nDev Container configs"]
    Root --> Docs["docs/\nDocumentation"]
    Root --> Config["config/\nSettings templates"]
    Root --> Workflows[".github/workflows/\nCI, Rust release, and VSCode publish"]
    Root --> VSCodeExt["vscode-extension/\nVS Code extension"]

    Src --> Main["main.rs\nEntry point, CLI dispatch"]
    Src --> Cli["cli.rs\nclap derive structs"]
    Src --> ConfigRs["config.rs\n.env loading, env resolution"]
    Src --> Utils["utils.rs\nShell exec, path resolution, slugify"]
    Src --> ManifestMod["manifest/mod.rs\nManifest, Epic, PrdEntry, Repository"]
    Src --> PrdMod["prd/mod.rs\nPRD struct, metadata extraction"]
    Src --> Provider["provider/\nAI provider abstraction"]
    Src --> Pipeline["pipeline/\nOrchestration, Ralph Loop, Dev Container"]
    Src --> Git["git/\nClone, branch, rebase, PR"]
    Src --> ContextMod["context/mod.rs\nSkill assembly, frontmatter stripping"]
    Src --> Logging["logging/\nTracing, formatter, monitor"]

    Provider --> ProviderMod["mod.rs\nProvider trait"]
    Provider --> Claude["claude.rs\nClaude Code CLI flags"]
    Provider --> Gemini["gemini.rs\nGemini CLI flags"]

    Pipeline --> PipelineMod["mod.rs\nAgent ordering, blocking"]
    Pipeline --> Orchestrator["orchestrator.rs\nParallel epics (default),\noptional --sequential-epics"]
    Pipeline --> Runner["runner.rs\nSingle PRD x repo pipeline"]
    Pipeline --> Agent["agent.rs\nRalph Loop"]
    Pipeline --> Devcontainer["devcontainer.rs\nDev Container lifecycle"]

    Git --> GitMod["mod.rs\nClone, branch, rebase, push"]
    Git --> Pr["pr.rs\ngh pr create, evidence comments"]

    Logging --> LoggingMod["mod.rs\nTracing setup"]
    Logging --> Formatter["formatter.rs\nJSONL stream formatting"]
    Logging --> Monitor["monitor.rs\nReal-time log tailing"]

    Agents --> ABase["_base-system.md"]
    Agents --> APrompts["*/prompt.md\nPer-agent prompts"]

    DevC --> DCMain["devcontainer.json\nFor editing this repo"]
    DevC --> DCAgent["agent/\nFor agent execution"]
    DevC --> InitFirewall["init-firewall.sh\nNetwork firewall"]
    DevC --> PostCreate["post-create.sh"]
    DevC --> PostStart["post-start.sh"]

    Workflows --> CI["ci.yml\nBuild, test, clippy, fmt"]
    Workflows --> Release["release.yml\nCross-compile, GitHub Releases, Homebrew"]
    Workflows --> PublishVSCode["publish-vscode.yml\nVSCode extension publish on vscode-v* tags"]
```

## Component Relationships

```mermaid
flowchart LR
    subgraph UserInput["User Input"]
        Desc["Interactive Prompt\n(describe what to build)"]
        ManifestFile["Manifest JSON\n(epics, subtasks, repos)"]
        EnvFile[".env config"]
    end

    subgraph CLILayer["CLI Layer"]
        MainRs["main.rs\n(entry point)"]
        CliRs["cli.rs\n(clap subcommands)"]
        ConfigRs["config.rs\n(.env, env resolution)"]
    end

    subgraph PipelineLayer["Pipeline Layer"]
        OrchestratorRs["orchestrator.rs\n(manifest dispatch)"]
        RunnerRs["runner.rs\n(single PRD x repo)"]
        AgentRs["agent.rs\n(Ralph Loop)"]
        DevcontainerRs["devcontainer.rs\n(RAII lifecycle)"]
    end

    subgraph AgentLayer["Agent Layer"]
        BaseSystem["_base-system.md"]
        Prompts["Agent prompts\n(14 agents)"]
    end

    subgraph Infra["Infrastructure"]
        DC[".devcontainer/agent/\n(headless container)"]
        MCP[".mcp.json"]
        AICLI["AI CLI\n(Claude Code or Gemini)"]
    end

    subgraph Output["Pipeline Output"]
        Branch["Feature branch"]
        Artifacts["Architecture docs\nDesign specs\nTest reports"]
        PullReq["Pull Request"]
        Evidence["Evidence comments"]
    end

    Desc -->|"generate prd"| ManifestFile
    ManifestFile --> MainRs
    EnvFile --> ConfigRs
    ConfigRs --> MainRs
    CliRs --> MainRs
    MainRs -->|"orchestrate"| OrchestratorRs
    OrchestratorRs -->|"per PRD x repo"| RunnerRs
    RunnerRs --> DevcontainerRs
    RunnerRs -->|"per agent"| AgentRs
    AgentRs --> BaseSystem
    AgentRs --> Prompts
    AgentRs -->|"invokes"| AICLI
    AICLI -->|"uses"| MCP
    DC -->|"sandbox for"| AICLI
    AICLI --> Branch
    AICLI --> Artifacts
    RunnerRs --> PullReq
    PullReq --> Evidence
```

## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `clap` | CLI argument parsing (derive) |
| `tokio` | Async runtime |
| `serde` / `serde_json` | JSON serialization |
| `anyhow` / `thiserror` | Error handling |
| `tracing` / `tracing-subscriber` | Structured logging |
| `notify` | File watching (monitor) |
| `dialoguer` | Interactive prompts |
| `indicatif` | Progress bars |
| `which` | PATH lookup for AI CLIs |
| `dotenvy` | `.env` loading |

## File Reference

| File | Purpose | Modified When |
|------|---------|---------------|
| `Cargo.toml` | Rust project manifest, dependencies | Adding crates, changing build config |
| `src/main.rs` | Entry point, CLI dispatch, generator commands | Adding subcommands, changing flow |
| `src/cli.rs` | clap derive structs for all subcommands | Adding/removing CLI options |
| `src/config.rs` | `.env` loading, env var resolution, defaults | Adding config options |
| `src/utils.rs` | Shell exec helpers, path resolution, slugify | Changing utility behavior |
| `src/manifest/mod.rs` | Manifest JSON (epics, subtasks, optional iteration fields), PRD-generate injection | Changing manifest schema |
| `src/prd/mod.rs` | PRD struct, metadata extraction (title, status, branch) | Changing PRD metadata format |
| `src/provider/mod.rs` | Provider trait | Adding providers |
| `src/provider/claude.rs` | Claude Code CLI flags, session extraction | Changing Claude invocation |
| `src/provider/gemini.rs` | Gemini CLI flags, session extraction | Changing Gemini invocation |
| `src/pipeline/mod.rs` | Agent ordering, blocking classification | Changing agent sequence |
| `src/pipeline/orchestrator.rs` | Parallel epics by default (`--sequential-epics` opt-in), per-epic workdir, sequential subtasks per epic, wave stacking, shared concurrency cap | Changing orchestration logic |
| `src/pipeline/runner.rs` | Single PRD × repo pipeline; stash-if-dirty before feature-branch checkout and before rebase; optional push of feature branch with 0 commits when orchestration needs `origin/<branch>` for stacked follow-ups; per-agent Dev Container by default (`reuse_devcontainer` opt-in) | Changing pipeline flow |
| `src/pipeline/agent.rs` | Ralph Loop; provider CLI with null stdin (headless); JSONL tail + hints on non-zero exit; Claude auth and rate-limit / quota fail-fast from JSONL; `devcontainer exec` when Dev Container enabled | Changing iteration logic |
| `src/pipeline/devcontainer.rs` | Serialized `devcontainer up` (avoids parallel feature-download races); streaming `exec` (same `--config` as `up`) / stop; host→container path rewrite | Changing container behavior |
| `src/git/mod.rs` | Clone, branch, stash-before-rebase (includes untracked), `ls-remote` / fetch `origin/<base>`, rebase, push with rebase-on-reject retry, stash pop, commit-ahead check | Changing git workflow |
| `src/git/pr.rs` | `gh pr create` (validates `HEAD` vs expected feature branch, explicit `--head`), evidence comments | Changing PR creation |
| `src/context/mod.rs` | Skill assembly, frontmatter stripping | Changing context format |
| `src/logging/mod.rs` | Tracing setup | Changing log config |
| `src/logging/formatter.rs` | JSONL stream formatting (Claude + Gemini) | Changing log format |
| `src/logging/monitor.rs` | Real-time log tailing (notify-based) | Changing monitoring |
| `scripts/install.sh` | Binary download installer (GitHub Releases) | Changing install path, platforms |
| `vscode-extension/` | VS Code / Cursor extension (TypeScript, esbuild, Jest) | Changing IDE integration |
| `vscode-extension/README.md` | Marketplace listing: features, quick start, configuration, contributor guide | Extension release or feature changes |
| `docs/vscode-extension.md` | VS Code extension feature guide: commands, configuration, activation, troubleshooting | Extension feature changes |
| `docs/vscode-install.md` | End-user installation guide: Marketplace, VSIX, build from source | Install options or prerequisites change |
| `docs/vscode-publish.md` | Maintainer publishing guide: one-time setup, release process, PAT rotation | Publish workflow or secrets change |
| `agents/_base-system.md` | Shared instructions for all agents | Changing universal agent behavior |
| `agents/*/prompt.md` | Per-agent instructions and completion criteria | Modifying agent behavior |
| `manifests/*.json` | Execution plans: epics, subtasks, repos, contexts | Adding projects or changing plans |
| `prds/<project>/` | Product Requirements Documents (referenced by manifests) | Adding or editing PRDs |
| `contexts/<repo>/` | Per-repo context skill directories | Repo conventions change |
| `templates/manifest.json` | Manifest template | Changing manifest schema |
| `templates/prd.md` | PRD template | Changing required PRD sections |
| `templates/context-skill.md` | Context skill template | Changing context skill format |
| `.devcontainer/devcontainer.json` | Dev Container for editing this repo | Changing IDE dev environment |
| `.devcontainer/agent/*` | Dev Container for running agents headlessly | Changing agent sandbox |
| `.devcontainer/init-firewall.sh` | Network firewall (only remaining shell script) | Changing firewall rules |
| `.devcontainer/post-create.sh` | Container setup hook | Changing container setup |
| `.devcontainer/post-start.sh` | Container start hook | Changing container startup |
| `.github/workflows/ci.yml` | Build, test, clippy, fmt | Changing CI steps |
| `.github/workflows/release.yml` | Cross-compile, GitHub Releases, Homebrew | Changing release process |
| `.github/workflows/publish-vscode.yml` | VS Code extension publish on `vscode-v*` tags: lint → test → version validate → vsce package → Marketplace publish → GitHub Release upload → Open VSX (optional) | Changing extension publish process |
| `.mcp.json` | MCP server connections | Adding/removing integrations |
| `.env.example` | Environment variable reference | Adding new config options |
| `docs/configuration.md` | `.env` and `WISP_ROOT_DIR` for Homebrew/curl | Changing install config |
| `config/settings.json` | AI CLI settings template | Changing default model |
| `skills/*/SKILL.md` | Cursor agent skills | Adding skills or changing workflows |
| `CLAUDE.md` | Claude Code instructions for this repo | Changing project conventions |
| `docs/*.md` | This documentation | Any significant change |
