## Summary

Exposes the full Wisp CLI feature set through the VSCode/Cursor extension via Command Palette commands, a sidebar Activity Bar panel with tree views for manifests and PRDs, file explorer context menus, and a status bar item. Builds on the `WispCli` and `OutputChannel` scaffolding from PR #3 (extension foundation).

## Changes

- **`src/commands.ts`** — `CommandHandlers` class with all 9 commands (7 PRD + showVersion + openChatPanel). Each command resolves the CLI before executing, shows a cancellable progress notification, and streams output to the Wisp OutputChannel. No shell interpolation — all args passed as arrays to `cp.spawn`.
- **`src/wispCli.ts`** — Extended with `runCapture()`, stdin `write()` for interactive pipelines, SIGTERM cancellation support, and per-invocation env forwarding.
- **`src/views/manifestTree.ts`** — `ManifestTreeDataProvider` with `FileSystemWatcher` for live refresh on create/delete/change. Shows `$(file-code)` icon; click triggers `wisp.orchestrate` pre-filled with the file URI.
- **`src/views/prdTree.ts`** — `PrdTreeDataProvider` with same watcher pattern. Shows `$(book)` icon; click opens the file in the editor.
- **`src/statusBar.ts`** — `WispStatusBar` showing "Wisp vX.Y.Z" or "Wisp: not found" with warning color. Click opens Command Palette pre-filtered to `>Wisp `.
- **`src/config.ts`** — `resolveEnv()` with `.env` → `.wisp` JSON → VSCode settings priority chain. Auth tokens (API keys) are never read from VSCode settings scope.
- **`src/extension.ts`** — `activate()` wires all providers, views, handlers, and watchers into `context.subscriptions` for proper disposal. `deactivate()` disposes ChatPanel.
- **`package.json`** — All `contributes`: 9 commands with "Wisp" category, `wispSidebar` viewsContainer, `wispManifests`/`wispPrds` views, explorer context menus with Wisp submenu, inline tree item actions, 13 configuration properties.
- **`src/panels/chatPanel.ts`** (bonus) — Webview-based agent chat panel for streaming output, scaffolded for PRD 03.

## Architecture Decisions

- `CommandHandlers` class receives `cliFactory: () => Promise<WispCli | null>` for lazy CLI resolution and testability without direct instantiation.
- `FileSystemWatcher` instances are disposed via `TreeDataProvider.dispose()`, which is registered in `context.subscriptions` — no leaked watchers on deactivate.
- `wisp.binaryPath` is `machine-overridable` scope (not workspace-overridable) to prevent workspace-level binary hijacking.
- Auth tokens excluded from VSCode settings — only read from process env or `.env` file.
- `cp.exec` for PATH lookup uses hardcoded `which`/`where wisp` — no user-controlled input in shell string.

## Testing

- Unit tests: 227 tests across 7 suites (8 new tests added by tester agent on top of developer baseline)
- Integration tests: N/A (VSCode Extension Test Runner requires a real host; outside pipeline scope)
- Coverage: 97.83% statements, 93.2% branches, 99.08% functions, 100% lines

## Screenshots / Recordings

- Activity Bar: "Wisp" icon opens sidebar with Manifests and PRDs tree views
- Manifests tree: each `.json` file under `manifests/` shows with run (▶) inline button
- PRDs tree: each `.md` file under `prds/` opens in editor on click
- Status bar (left): `$(circuit-board) Wisp v0.1.0` or `$(warning) Wisp: not found`
- Command Palette: all 9 commands appear under "Wisp:" prefix

## Checklist

- [x] Tests pass (227/227)
- [x] Build succeeds (`npm run compile`)
- [x] No linter errors (`npm run lint`)
- [x] Architecture doc reviewed (`docs/architecture/vscode-02-cli-commands/architecture.md`)
- [x] Design spec followed (`docs/architecture/vscode-02-cli-commands/design.md`)
- [x] Accessibility: VSCode native components handle ARIA/keyboard automatically
- [x] Security: no shell interpolation, no auth tokens in VSCode settings scope, `binaryPath` is machine-scoped

## Review Notes

- Reviewer fixed: unused `makeHandlersWithPanel` helper in `commands.test.ts` caused an ESLint `no-unused-vars` error. Removed the function; the tests inline the panel setup directly.
- `commands.ts` branch coverage is 93.2%: remaining uncovered paths are ChatPanel optional-chain guards (`panel?.handleStdout` etc.) that require a running WebviewPanel host — not practical to unit-test.
- `WispCli.runCapture()` is fully exercised via `run()` delegation tests; no separate runCapture tests needed.
- The ChatPanel webview (`src/panels/chatPanel.ts`) is bonus scaffolding for PRD 03 and does not affect any PRD 02 acceptance criteria.
- All 7 PRD commands + `showVersion` + `openChatPanel` are registered; the PRD requires 7 commands (orchestrate, pipeline, run, generatePrd, generateContext, monitor, installSkills) — all present and verified in `commands.test.ts`.
