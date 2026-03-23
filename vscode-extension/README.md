# Wisp for VS Code

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/delehner.wisp?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=delehner.wisp)

Run [Wisp](https://github.com/delehner/wisp) AI pipelines directly from VS Code — no terminal switching required. All Wisp CLI commands are available from the Command Palette with interactive prompts, real-time streaming output, and a status bar indicator.

## Prerequisites

- **VS Code 1.85 or later**
- A built **`wisp` binary** on your `PATH`, or configure **`wisp.binaryPath`** in VS Code settings. See the [Installation Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-install.md) for how to install the CLI.

## Quick Start

1. Install this extension from the Marketplace (or [install from VSIX / source](https://github.com/delehner/wisp/blob/main/docs/vscode-install.md)).
2. Open a folder that contains a `manifests/` or `prds/` directory so the extension activates automatically.
3. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Wisp: Show Version**.

You should see the `wisp` version string. If the binary is not found, set `wisp.binaryPath` (see [Configuration](#configuration)) or follow the [Installation Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-install.md#troubleshooting).

## Commands

### Command Palette

All commands are available via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Palette Title | Description |
|---------|--------------|-------------|
| `wisp.orchestrate` | Wisp: Orchestrate Manifest | Select a manifest JSON file and run the full multi-repo pipeline |
| `wisp.pipeline` | Wisp: Run Pipeline | Run a single PRD through the agent pipeline for a given repo and branch |
| `wisp.run` | Wisp: Run Agent | Run a single named agent (pick from 14) against a workdir and PRD |
| `wisp.generatePrd` | Wisp: Generate PRDs | Generate PRD files from a description and optional repo URLs |
| `wisp.generateContext` | Wisp: Generate Context | Generate context skill files for a repository |
| `wisp.monitor` | Wisp: Monitor Logs | Select a log session and stream its output live |
| `wisp.installSkills` | Wisp: Install Skills | Install Cursor-compatible skill files into the workspace |
| `wisp.update` | Wisp: Update | Self-update the wisp binary to the latest release |
| `wisp.stopPipeline` | Wisp: Stop Pipeline | Kill the currently-running wisp process |
| `wisp.showOutput` | Wisp: Show Output | Bring the Wisp output channel into focus |
| `wisp.showVersion` | Wisp: Show Version | Display the installed wisp binary version |

Explorer toolbar and context menus also expose **Refresh**, **Open File**, **Run Orchestrate**, **Run Orchestrate (this epic only)**, and **Run Pipeline** when you use the **Wisp Explorer** view in the Activity Bar.

## Features

- **Wisp Explorer** — Activity Bar tree for workspace `manifests/*.json` and `prds/**/*.md`, with refresh and context actions to run orchestrate or pipeline from a node
- **Real-time streaming output** — pipeline output appears line-by-line in a dedicated "Wisp" Output Channel; no buffering
- **Status bar indicator** — shows `$(sync~spin) Wisp: Running` during active pipelines and `$(check) Wisp: Idle` otherwise; click to open the Output Channel
- **File pickers** — manifest commands filter to `**/manifests/*.json`; PRD commands filter to `**/prds/**/*.md`
- **Process cancellation** — `wisp.stopPipeline` sends SIGTERM to the running process and resets the status bar
- **Injection-safe** — child process arguments are passed as arrays to `child_process.spawn`; no shell string interpolation

## Configuration

| Setting | Type | Scope | Description |
|---------|------|-------|-------------|
| `wisp.binaryPath` | string | Machine | Absolute path to the wisp binary. Leave empty to use the binary found on `PATH`. Cannot be overridden by workspace settings. |

```jsonc
// settings.json (User or Machine settings)
{
  "wisp.binaryPath": "/usr/local/bin/wisp"
}
```

**Security:** `wisp.binaryPath` is machine-scoped so a repository’s `.vscode/settings.json` cannot point the extension at an untrusted binary.

## Documentation

- [Installation Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-install.md) — Marketplace, VSIX, or from source
- [Feature Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-extension.md) — commands, configuration, troubleshooting
- [Publishing Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-publish.md) — maintainers: releases and PAT setup

## Troubleshooting

**Binary not found** — Add `wisp` to your `PATH`, or set `wisp.binaryPath` in User Settings. See the [Installation Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-install.md#troubleshooting).

**Commands don't appear in the Command Palette** — The extension activates when the workspace contains `manifests/*.json` or `prds/**/*.md` files. Open a Wisp project folder, or search for "Wisp" in the Command Palette to trigger activation.

---

## For contributors and maintainers

**Node.js 20+** is required only for `npm ci`, tests, and packaging — not for end users installing from the Marketplace.

### Build and test (before GitHub / PR)

From the **repository root** (Rust CLI):

```bash
cargo build --release
cargo test
cargo clippy
```

From **`vscode-extension/`**:

```bash
npm ci
npm run compile
npm test
npm run lint
```

CI runs the same checks (see `.github/workflows/ci.yml`).

### Try it in the editor

1. Open the **`vscode-extension`** folder in VS Code or Cursor (File → Open Folder).
2. Run **Run → Start Debugging** (F5) to launch an **Extension Development Host** with this extension loaded.
3. In that window, run **Wisp: Show Version** from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

Ensure the `wisp` binary is on `PATH` in the host, or set **Wisp: Binary Path** (`wisp.binaryPath`) in User Settings.

### Package a `.vsix` (local install, no Marketplace)

```bash
cd vscode-extension
npm run package
```

Install the generated `wisp-0.1.0.vsix` via **Extensions → … → Install from VSIX…**.

### Publish

Publishing is automated via `.github/workflows/publish-vscode.yml`. Push a `vscode-v*` tag to trigger it. See the [Publishing Guide](https://github.com/delehner/wisp/blob/main/docs/vscode-publish.md) for one-time setup and release steps.

### Scripts

| Script | Action |
|--------|--------|
| `compile` | esbuild bundle → `out/extension.js` |
| `watch` | Rebuild on file changes |
| `test` | Jest unit tests (mocked `vscode`) |
| `lint` | ESLint on `src/**/*.ts` |
| `package` | `vsce package` → `.vsix` |
