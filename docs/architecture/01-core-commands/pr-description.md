## Summary

Implements all wisp CLI commands as VS Code command palette entries with interactive input prompts, real-time streamed output, and a status bar indicator — delivering the primary user-facing value of the wisp VS Code extension.

## Changes

- **`vscode-extension/src/wispCli.ts`**: Added `_proc: cp.ChildProcess | null`, `cancel()` (SIGTERM), and `get isRunning` to support pipeline cancellation
- **`vscode-extension/src/statusBar.ts`**: New `WispStatusBar` class — shows spinning icon when running, checkmark when idle; clicking opens Output Channel
- **`vscode-extension/src/commands/utils.ts`**: Shared helpers — `KNOWN_AGENTS` (14 agents), `pickManifestFile()`, `pickPrdFile()`, `runWithOutput()`, `registerInstallSkillsCommand()`, `registerUpdateCommand()`
- **`vscode-extension/src/commands/orchestrate.ts`**: `wisp.orchestrate` — manifest file picker → `wisp orchestrate --manifest <path>`
- **`vscode-extension/src/commands/pipeline.ts`**: `wisp.pipeline` — PRD picker, repo URL (validated), branch input → `wisp pipeline`
- **`vscode-extension/src/commands/run.ts`**: `wisp.run` — agent QuickPick (14 agents), workdir, PRD picker → `wisp run`
- **`vscode-extension/src/commands/generate.ts`**: `wisp.generatePrd` and `wisp.generateContext` — description/URL inputs → `wisp generate prd/context`
- **`vscode-extension/src/commands/monitor.ts`**: `wisp.monitor` — session list QuickPick → `wisp monitor --session <id>`
- **`vscode-extension/src/extension.ts`**: Extended activate() — registers all 11 commands, creates WispStatusBar, tracks `activeCli` for cancellation
- **`vscode-extension/package.json`**: 10 new commands in `contributes.commands`; `wisp.binaryPath` config (machine-scoped)
- **`vscode-extension/README.md`**: Added Features section, Commands table (11 commands), Configuration table
- **`vscode-extension/CHANGELOG.md`**: Created — v0.1.0 initial release entry

## Architecture Decisions

- **Single `activeCli` ref**: Module-scoped in `extension.ts`; matches single-pipeline-at-a-time model (no registry needed)
- **`runWithOutput()` helper**: All 7 streaming commands share one implementation; prevents duplication
- **Args as arrays**: All child process arguments passed as array entries to `cp.spawn()` — no shell string interpolation, eliminating injection risk via file paths or branch names
- **File pickers with fallback**: `workspace.findFiles()` + QuickPick; falls back to `showInputBox` if no files found in workspace
- **`onActivate`/`onDone` callbacks**: `extension.ts` manages `activeCli` via callbacks into each `register*Command()` — avoids circular imports

## Testing

- Unit tests: 76 tests across 7 test suites (all pass)
- New test files: `commandUtils.test.ts`, `orchestrate.test.ts`, `pipeline.test.ts`, `run.test.ts`, `generate.test.ts`, `monitor.test.ts`
- Extended: `wispCli.test.ts` (cancel/isRunning, proc error event, runCapture, statusBar.dispose)
- Strategy: arg construction and guard logic tested — not VS Code UI interaction internals
- Coverage: 97.2% statements / 100% functions / 83.1% branches

## Checklist

- [x] Tests pass (76/76)
- [x] Build succeeds
- [x] TypeScript strict mode passes (`tsc --noEmit`)
- [x] No linter errors
- [x] Architecture doc reviewed
- [x] Security considerations addressed (no shell interpolation; machine-scoped binaryPath)
- [x] Accessibility: QuickInput placeholder text describes expected format; notifications use appropriate severity

## Review Notes

- `wisp.generatePrd` skips `--interactive` mode per PRD spec (open question); uses `--description` flag only
- Output Channel is created once in `activate()` and reused across all command invocations
- `wisp.stopPipeline` sends SIGTERM; if the child process ignores SIGTERM, a subsequent SIGKILL could be added in a follow-up
- Reviewer fix: replaced `require('../statusBar')` in `wispCli.test.ts` with a proper ES import to satisfy `@typescript-eslint/no-var-requires`
