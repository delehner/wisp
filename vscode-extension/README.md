# Wisp VS Code extension

Run wisp pipelines from the VS Code command palette — no terminal required. All wisp CLI commands are available as palette entries with interactive input prompts, real-time streaming output, and a status bar indicator.

## Prerequisites

- Node.js 20+ (for `npm ci` / tooling)
- A built **`wisp` binary** on your `PATH`, or configure **`wisp.binaryPath`** in VS Code settings after install

## Commands

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

## Features

- **Real-time streaming output** — all pipeline output appears line-by-line in a dedicated "Wisp" Output Channel as it is emitted; no buffering
- **Status bar indicator** — shows `$(sync~spin) Wisp: Running` during active pipelines and `$(check) Wisp: Idle` otherwise; click to open the Output Channel
- **File pickers** — manifest commands filter to `**/manifests/*.json`; PRD commands filter to `**/prds/**/*.md`
- **Process cancellation** — `wisp.stopPipeline` sends SIGTERM to the running process and resets the status bar
- **Injection-safe** — all child process arguments are passed as array entries to `child_process.spawn`; no shell string interpolation

## Configuration

| Setting | Type | Scope | Description |
|---------|------|-------|-------------|
| `wisp.binaryPath` | string | Machine | Absolute path to the wisp binary. Leave empty to use the binary found on `PATH`. |

## Build and test (before GitHub / PR)

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

## Try it in the editor

1. Open the **`vscode-extension`** folder in VS Code or Cursor (File → Open Folder).
2. Run **Run → Start Debugging** (F5) to launch an **Extension Development Host** with this extension loaded.
3. In that window, run **Wisp: Show Version** from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

Ensure the `wisp` binary is on `PATH` in the host, or set **Wisp: Binary Path** (`wisp.binaryPath`) in User Settings.

## Package a `.vsix` (local install, no Marketplace)

```bash
cd vscode-extension
npm run package
```

Install the generated `wisp-0.1.0.vsix` via **Extensions → … → Install from VSIX…**.

## Scripts

| Script      | Action                          |
|------------|----------------------------------|
| `compile`  | esbuild bundle → `out/extension.js` |
| `watch`    | Rebuild on file changes          |
| `test`     | Jest unit tests (mocked `vscode`) |
| `lint`     | ESLint on `src/**/*.ts`          |
| `package`  | `vsce package` → `.vsix`         |
