# Architecture: VSCode Extension — Core Command Palette Integration

## Overview

This feature extends the wisp VSCode extension scaffold to expose all 9 wisp CLI subcommands as VS Code command palette entries. Each command collects user input via QuickInput, streams subprocess output line-by-line to a dedicated Output Channel, and reports pipeline state via a status bar item.

## System Design

### Components

- **`WispCli`** (`src/wispCli.ts`): Binary resolution (config override → `which`/`where` → install prompt), child process lifecycle (`run()`, `runCapture()`, `cancel()`), `isRunning` guard. Extended with `cancel(): void` and `get isRunning(): boolean` for FR-10.
- **`WispStatusBar`** (`src/statusBar.ts`): Wraps `vscode.StatusBarItem`. `setRunning()` shows spinner + "Wisp: Running"; `setIdle()` shows check + "Wisp: Idle". Click reveals Output Channel.
- **`commands/orchestrate.ts`**: FR-1 — manifest file picker → `wisp orchestrate --manifest <path>`.
- **`commands/pipeline.ts`**: FR-2 — PRD picker + repo URL + branch inputs → `wisp pipeline --prd --repo --branch`.
- **`commands/run.ts`**: FR-3 — agent QuickPick (14 agents) + workdir + PRD picker → `wisp run --agent --workdir --prd`.
- **`commands/generate.ts`**: FR-4 + FR-5 — description + repeatable repo URLs → `wisp generate prd`; repo + branch → `wisp generate context`.
- **`commands/monitor.ts`**: FR-6 — session list via `wisp monitor --list` → QuickPick → `wisp monitor --session <id>`.
- **`commands/utils.ts`**: FR-7 + FR-8 — `wisp install skills`, `wisp update`.
- **`extension.ts`**: `activate()` wires all commands, owns single Output Channel + StatusBar instances, tracks `activeCli` for stop support.

### Data Flow

```
User → Command Palette
  → command handler (e.g. registerOrchestrateCommand)
    → pickManifestFile() / showInputBox() / showQuickPick()
    → WispCli.resolve()  (binary lookup, once per invocation)
    → statusBar.setRunning() + onActivate(cli)
    → runWithOutput(cli, args, cwd, outputChannel)
      → WispCli.run(args, cwd, onStdout, onStderr)
        → cp.spawn(binaryPath, args, { cwd })
        → readline on stdout/stderr → outputChannel.appendLine()
    → statusBar.setIdle() + onDone()
```

### Data Models

No persistent data models. Runtime state:
- `activeCli: WispCli | null` — tracks currently-running process for cancel support
- `WispStatusBar` — wraps `vscode.StatusBarItem` with two states

### API Contracts

`WispCli` public surface:
```typescript
static resolve(): Promise<WispCli | null>
run(args: string[], cwd: string, onStdout, onStderr, opts?): Promise<number>
runCapture(args: string[], cwd: string): Promise<CaptureResult>
cancel(): void
get isRunning(): boolean
```

Shared command utilities (`commands/utils.ts`):
```typescript
const KNOWN_AGENTS: string[]  // 14 agent names
function pickManifestFile(cwd: string): Promise<string | undefined>
function pickPrdFile(cwd: string): Promise<string | undefined>
function runWithOutput(cli, args, cwd, outputChannel, statusBar, onActivate, onDone): Promise<void>
```

Each `commands/*.ts` module exports a single `register*Command(context, outputChannel, statusBar, onActivate, onDone)` function.

## File Structure

```
vscode-extension/
├── src/
│   ├── extension.ts              # activate(): wires all commands, owns OutputChannel + StatusBar
│   ├── wispCli.ts                # WispCli class (extended with cancel/isRunning)
│   ├── statusBar.ts              # WispStatusBar class
│   ├── commands/
│   │   ├── orchestrate.ts        # FR-1: wisp.orchestrate
│   │   ├── pipeline.ts           # FR-2: wisp.pipeline
│   │   ├── run.ts                # FR-3: wisp.run
│   │   ├── generate.ts           # FR-4 + FR-5: wisp.generatePrd, wisp.generateContext
│   │   ├── monitor.ts            # FR-6: wisp.monitor
│   │   └── utils.ts              # FR-7 + FR-8 + shared helpers
│   └── __tests__/
│       ├── wispCli.test.ts       # WispCli + package.json contract tests
│       ├── commandUtils.test.ts  # KNOWN_AGENTS, pickers, runWithOutput
│       ├── orchestrate.test.ts
│       ├── pipeline.test.ts
│       ├── run.test.ts
│       ├── generate.test.ts
│       └── monitor.test.ts
```

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Command file structure | One file per command group under `commands/` | Aligns with PRD spec; keeps each handler small and independently testable | Single `commands.ts` monolith (harder to test/review) |
| Shared `runWithOutput` helper | Extracted to `commands/utils.ts` | Eliminates repetition across 8 commands; single place for already-running guard | Inline per command (copy-paste risk) |
| Output Channel ownership | Created once in `activate()`, passed to all commands | VS Code best practice — one channel per extension, reused across invocations | Per-command channels (clutters Output panel) |
| `activeCli` tracking | Module-level var in `extension.ts` via `onActivate`/`onDone` callbacks | Simple; avoids shared mutable state crossing module boundaries | `EventEmitter` or context-attached state |
| Process args | Array (never shell string) | Prevents injection via file paths containing spaces or special chars | Template string interpolation (injection risk) |
| Binary resolution | Config override → `which`/`where` → install prompt | Matches existing scaffold pattern; zero-config for users with wisp on PATH | Hardcoded path |

## Dependencies

No new npm dependencies. All APIs used:
- `vscode` (built-in extension API)
- `node:child_process` (already used by scaffold)
- `node:readline` (already used by scaffold)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Long-running pipelines flood Output Channel | Low | Output Channel handles large output natively; no pagination needed |
| `wisp generate prd` interactive stdin mode | Medium | Skip `--interactive`; use `--description` flag only (PRD decision) |
| Multiple workspace folders open | Low | Always use `workspaceFolders[0]` as CWD, matching CLI behavior |
| Child process not cleaned up on extension deactivate | Low | `deactivate()` nils `activeCli`; process inherits VS Code lifecycle |

## Implementation Tasks

1. **Extend `WispCli`** — add `_proc` field, `cancel()` method, `isRunning` getter. Store `cp.ChildProcess` ref in `run()`.
2. **Create `WispStatusBar`** — wrap `StatusBarItem`, implement `setRunning()` / `setIdle()` / `dispose()`. Wire click to `wisp.showOutput`.
3. **Create `commands/utils.ts`** — `KNOWN_AGENTS`, `pickManifestFile()`, `pickPrdFile()`, `runWithOutput()`, `registerInstallSkillsCommand()`, `registerUpdateCommand()`.
4. **Create `commands/orchestrate.ts`** — manifest picker + `wisp orchestrate --manifest <path>`.
5. **Create `commands/pipeline.ts`** — PRD picker + repo URL validation + branch input.
6. **Create `commands/run.ts`** — agent QuickPick + workdir + PRD picker.
7. **Create `commands/generate.ts`** — description + repeatable repo URLs (generatePrd); repo + branch (generateContext).
8. **Create `commands/monitor.ts`** — session listing via `runCapture(['monitor', '--list'])` + QuickPick.
9. **Update `extension.ts`** — register all commands; add `wisp.stopPipeline` + `wisp.showOutput` inline; own Output Channel + StatusBar.
10. **Update `package.json`** — declare all 11 commands in `contributes.commands`; add `wisp.binaryPath` config entry.
11. **Write tests** — Jest tests for each module against `src/__mocks__/vscode.ts` mock.

## Security Considerations

- All child process arguments are passed as array entries to `cp.spawn()` — no shell string interpolation. This is enforced throughout `commands/*.ts`.
- `WispCli.binaryPath` comes from VS Code config (trusted user input) or `which` resolution — not from workspace file contents.

## Performance Considerations

- Output streaming via `readline` on `proc.stdout`/`proc.stderr` — lines appear within one readline tick of emission, well under the 100ms PRD requirement.
- `WispCli.resolve()` calls `which`/`where` once per command invocation (not cached) — acceptable for interactive use; cost is a single fast subprocess.
