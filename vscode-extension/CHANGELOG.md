# Changelog

All notable changes to the Wisp VS Code extension are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Wisp Explorer sidebar** — Activity Bar panel (custom Wisp icon) with two sections:
  - **Manifests** — parses all `manifests/*.json` in the workspace and displays epics, subtasks, and target repos as a collapsible tree; malformed JSON shows an error node
  - **PRDs** — lists all `prds/**/*.md` files grouped by subdirectory; clicking a node opens the file in the editor with title and status shown as tooltip/description
- **Context menus** on tree nodes:
  - Manifest nodes: "Run Orchestrate" (inline), "Open File"
  - Epic nodes: "Run Orchestrate (this epic only)" (inline)
  - Subtask nodes: "Run Pipeline" (inline)
  - PRD file nodes: "Open File"
- **Auto-refresh** — file system watcher detects changes to `**/manifests/*.json` and `**/prds/**/*.md` and refreshes the tree automatically (500 ms debounce)
- **Refresh button** (`$(refresh)`) in the Wisp Explorer toolbar for manual rescan

## [0.1.0] — 2026-03-20

### Added

- **11 command palette commands** covering the full wisp CLI surface:
  - `Wisp: Show Version` — display the installed wisp binary version
  - `Wisp: Orchestrate Manifest` — select a manifest JSON file and run the full multi-repo pipeline
  - `Wisp: Run Pipeline` — run a single PRD through the agent pipeline for a given repo and branch
  - `Wisp: Run Agent` — run a single named agent (pick from 14) against a workdir and PRD
  - `Wisp: Generate PRDs` — generate PRD files from a description and optional repo URLs
  - `Wisp: Generate Context` — generate context skill files for a repository
  - `Wisp: Monitor Logs` — select a log session and stream its output live
  - `Wisp: Install Skills` — install Cursor-compatible skill files into the workspace
  - `Wisp: Update` — self-update the wisp binary to the latest release
  - `Wisp: Stop Pipeline` — kill the currently-running wisp process
  - `Wisp: Show Output` — bring the Wisp output channel into focus
- **Real-time streaming output** in a dedicated "Wisp" Output Channel — no buffering
- **Status bar indicator** showing `$(sync~spin) Wisp: Running` / `$(check) Wisp: Idle`; click to open the Output Channel
- **File pickers** — manifest commands filter to `**/manifests/*.json`; PRD commands filter to `**/prds/**/*.md`
- **Process cancellation** — `Wisp: Stop Pipeline` sends SIGTERM and resets the status bar
- **Concurrent pipeline guard** — attempting to start a second pipeline while one is running shows a warning
- **`wisp.binaryPath` setting** (machine-scoped) to point to a wisp binary not on `PATH`
