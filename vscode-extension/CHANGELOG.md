# Changelog

All notable changes to the Wisp AI VS Code extension are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **Explorer command handlers now receive correct arguments** — clicking inline action buttons or context menu items in the Wisp AI Explorer (Run Orchestrate, Run Orchestrate (this epic only), Run Pipeline) no longer fails with `Error: failed to read manifest: [object Object]`. Handlers now correctly extract the file path or properties from the tree item object passed by VS Code.

### Added

- **Wisp AI Explorer sidebar** — Activity Bar panel (custom Wisp icon) with two sections:
  - **Manifests** — parses all `manifests/*.json` in the workspace and displays epics, subtasks, and target repos as a collapsible tree; malformed JSON shows an error node
  - **PRDs** — lists all `prds/**/*.md` files grouped by subdirectory; clicking a node opens the file in the editor with title and status shown as tooltip/description
- **Context menus** on tree nodes:
  - Manifest nodes: "Run Orchestrate" (inline), "Open File"
  - Epic nodes: "Run Orchestrate (this epic only)" (inline)
  - Subtask nodes: "Run Pipeline" (inline)
  - PRD file nodes: "Open File"
- **Auto-refresh** — file system watcher detects changes to `**/manifests/*.json` and `**/prds/**/*.md` and refreshes the tree automatically (500 ms debounce)
- **Refresh button** (`$(refresh)`) in the Wisp AI Explorer toolbar for manual rescan

## [0.1.0] — 2026-03-20

### Added

- **11 command palette commands** covering the full wisp CLI surface:
  - `Wisp AI: Show Version` — display the installed wisp binary version
  - `Wisp AI: Orchestrate Manifest` — select a manifest JSON file and run the full multi-repo pipeline
  - `Wisp AI: Run Pipeline` — run a single PRD through the agent pipeline for a given repo and branch
  - `Wisp AI: Run Agent` — run a single named agent (pick from 14) against a workdir and PRD
  - `Wisp AI: Generate PRDs` — generate PRD files from a description and optional repo URLs
  - `Wisp AI: Generate Context` — generate context skill files for a repository
  - `Wisp AI: Monitor Logs` — select a log session and stream its output live
  - `Wisp AI: Install Skills` — install Cursor-compatible skill files into the workspace
  - `Wisp AI: Update` — self-update the wisp binary to the latest release
  - `Wisp AI: Stop Pipeline` — kill the currently-running wisp process
  - `Wisp AI: Show Output` — bring the Wisp AI output channel into focus
- **Real-time streaming output** in a dedicated "Wisp AI" Output Channel — no buffering
- **Status bar indicator** showing `$(sync~spin) Wisp AI: Running` / `$(check) Wisp AI: Idle`; click to open the Output Channel
- **File pickers** — manifest commands filter to `**/manifests/*.json`; PRD commands filter to `**/prds/**/*.md`
- **Process cancellation** — `Wisp AI: Stop Pipeline` sends SIGTERM and resets the status bar
- **Concurrent pipeline guard** — attempting to start a second pipeline while one is running shows a warning
- **`wisp.binaryPath` setting** (machine-scoped) to point to a wisp binary not on `PATH`
