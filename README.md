# Wisp

## Summary

Wisp is a single Rust CLI that turns Product Requirements Documents (PRDs) into implemented work on real repositories: it clones targets, runs a configurable sequence of AI coding agents in isolated Dev Containers (Ralph loop), tracks progress under `.agent-progress/`, and opens Pull Requests via GitHub CLI. You can drive the same workflows from the terminal or from the optional **Wisp AI** VS Code extension.

**Repository:** [github.com/delehner/wisp](https://github.com/delehner/wisp)

## How to install

### CLI

**Pre-built binary** (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/delehner/wisp/main/scripts/install.sh | bash
```

**Homebrew:**

```bash
brew tap delehner/tap
brew install wisp
```

**From crates.io / source:**

```bash
cargo install wisp
```

The binary needs supporting assets (`agents/`, `templates/`, `.env`) on disk. If you installed with curl or Homebrew only, read [Configuration](docs/configuration.md) for `WISP_ROOT_DIR` and copying `.env.example` to `.env`.

**Verify:**

```bash
wisp --version
wisp --help
```

You also need the external tools Wisp shells out to: `git`, Docker, `devcontainer` CLI, `gh`, and either **Claude Code** or **Gemini CLI**. See [Prerequisites](docs/prerequisites.md) for versions, install commands, and auth (`claude` / `gh auth login`).

### Extension

The Wisp AI extension (publisher `delehner`) is a thin IDE front-end for the CLI: Command Palette commands, a Wisp explorer sidebar, and live output. It does not replace the CLI; install `wisp` first and ensure it is on your `PATH`.

- VS Code / Cursor: Extensions view → search “Wisp AI” → Install, open [Visual Studio Marketplace — Wisp AI](https://marketplace.visualstudio.com/items?itemName=delehner.wisp-ai), or follow [Installing the Wisp AI VS Code Extension](docs/vscode-install.md) (VSIX from [Releases](https://github.com/delehner/wisp/releases), or build from `vscode-extension/`).
- Features and settings: [VS Code Extension Feature Guide](docs/vscode-extension.md).

## Features

- Manifest-driven orchestration — run many PRDs across repos with epics, parallel and stacked same-repo waves, and per-unit agent lists (`wisp orchestrate`).
- Single PRD pipeline — one PRD and one repo end-to-end (`wisp pipeline`).
- Agent runner — one agent’s Ralph loop in a workdir (`wisp run`).
- PRD and context generation — scaffold PRDs and manifests from a repo description; generate context skills from a remote repo (`wisp generate prd`, `wisp generate context`).
- 14-stage default pipeline — Architect through Reviewer, with blocking vs non-blocking agents; evidence agents can post reports to PRs.
- Providers — Claude Code or Gemini CLI, with per-agent model and iteration overrides via environment variables.
- Dev Containers — optional execution inside the target repo’s Dev Container.
- Logging and recovery — JSONL logs, `wisp monitor`, `wisp logs`, session hints for CLI resume.
- IDE integration — Wisp AI extension: run orchestrate/pipeline, browse manifests and PRDs, install/update CLI helpers from the UI.
- Cursor skills — `wisp install skills` symlinks project skills.

For command tables, manifest JSON shape, and pipeline details, see [Pipeline overview](docs/pipeline-overview.md).

## How to contribute

Contributions are welcome via issues and pull requests on [delehner/wisp](https://github.com/delehner/wisp).

- Rust CLI: changes under `src/`. Run `cargo fmt`, `cargo clippy -- -D warnings`, and `cargo test` before opening a PR.
- VS Code extension: code under `vscode-extension/` (Node.js; `npm ci`, `npm run compile`, `npm run lint` as applicable).
- Agents and templates: prompts in `agents/` and templates in `templates/`; keep `schemas/manifest.schema.json` in sync with `src/manifest/` when structs change.

If you add a user-facing behavior, consider updating the relevant file under `docs/` and the index in [Documentation](#documentation).

## Documentation

Full guides live in [`docs/`](docs/README.md). The index is [docs/README.md](docs/README.md) (prerequisites, configuration, pipeline, Ralph loop, extension, MCP, adding agents, and architecture notes).

## License

MIT
