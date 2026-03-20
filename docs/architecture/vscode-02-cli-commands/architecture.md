# Architecture: VSCode Extension — CLI Commands Integration

## Overview

Extends the extension foundation (PRD 01) to expose all Wisp CLI subcommands through idiomatic VSCode UI patterns: Command Palette, a sidebar Activity Bar panel with two tree views (Manifests, PRDs), file-explorer context menus, and a status bar item. The implementation is entirely additive to `vscode-extension/` — no Rust source is modified.

---

## Current Implementation State

The following source files **already exist** on branch `delehner/vscode-02-cli-commands`:

| File | Status | Notes |
|------|--------|-------|
| `src/commands.ts` | ✅ Complete | `CommandHandlers` class, all 7 commands implemented |
| `src/views/manifestTree.ts` | ✅ Complete | `ManifestTreeDataProvider`, `WispTreeItem` |
| `src/views/prdTree.ts` | ✅ Complete | `PrdTreeDataProvider` |
| `src/statusBar.ts` | ✅ Complete | `WispStatusBar` |
| `src/config.ts` | ✅ Complete | `resolveEnv`, `resolveWispRoot`, `parseEnvFile` |
| `src/panels/chatPanel.ts` | ✅ Complete | ChatPanel WebView (bonus from PRD 03 scaffolding) |
| `src/types/messages.ts` | ✅ Complete | Message types for chatPanel ↔ WebView |
| `src/__tests__/*.test.ts` | ✅ Complete | Tests for commands, statusBar, manifestTree, prdTree, config |
| `src/extension.ts` | ❌ NOT wired | Only registers `wisp.showVersion`; all new components unregistered |
| `src/wispCli.ts` | ⚠️ Partial | Missing: `cancellationToken`, `env` in `RunOptions`; `write()` method; `runCapture()` opts param |
| `package.json` | ❌ NOT updated | Missing all new `contributes` entries |
| `resources/wisp.svg` | ❌ Missing | Activity Bar icon not yet created |

---

## System Design

### Component Map

```
ExtensionContext (activate)
├── OutputChannel("Wisp")                  ← created once, pushed to subscriptions
├── WispStatusBar                          ← status bar item (bottom-left)
│   └── cliFactory → WispCli.resolve()
├── CommandHandlers                        ← all 7 command implementations
│   ├── cliFactory → WispCli.resolve()
│   ├── outputChannel → shared OutputChannel
│   └── extensionUri → for ChatPanel
├── ManifestTreeDataProvider               ← "Wisp Manifests" tree view
│   └── FileSystemWatcher(**/manifests/**/*.json)
└── PrdTreeDataProvider                    ← "Wisp PRDs" tree view
    └── FileSystemWatcher(**/prds/**/*.md)
```

### Module Responsibility

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Lifecycle: `activate()` wires all components; `deactivate()` disposes them |
| `wispCli.ts` | Binary resolution, `cp.spawn` streaming with cancellation and env forwarding |
| `commands.ts` | Command implementations; thin handlers that delegate to `WispCli` |
| `views/manifestTree.ts` | `TreeDataProvider` for manifests; FileSystemWatcher |
| `views/prdTree.ts` | `TreeDataProvider` for PRDs; FileSystemWatcher |
| `statusBar.ts` | Status bar item showing binary version or "not found" state |
| `config.ts` | `.env` / `.wisp` / VSCode settings → `WISP_*` env vars; workspace root resolution |

---

## Implementation Gaps (Developer Must Fix)

### 1. `src/wispCli.ts` — Extend RunOptions and add `write()` / `env` support

The `CommandHandlers` class calls `cli.run(args, cwd, onStdout, onStderr, { cancellationToken: token, env })` and `cli.write('s\n')`, but `wispCli.ts` does not yet implement these.

**Required changes:**

```typescript
export interface RunOptions {
  outputChannel?: vscode.OutputChannel;
  cancellationToken?: vscode.CancellationToken;
  env?: Record<string, string>;
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class WispCli {
  private proc: cp.ChildProcess | undefined;

  // In run(): pass env to cp.spawn, register cancellationToken listener to SIGTERM proc
  async run(
    args: string[],
    cwd: string,
    onStdout: (line: string) => void,
    onStderr: (line: string) => void,
    opts?: RunOptions,
  ): Promise<number> { ... }

  // New: write to process stdin for interactive pipeline control (s/c/q)
  write(data: string): void {
    this.proc?.stdin?.write(data);
  }

  // Update signature to accept opts
  async runCapture(args: string[], cwd: string, opts?: RunOptions): Promise<CaptureResult> { ... }
}
```

**Cancellation implementation**: Register `opts.cancellationToken?.onCancellationRequested(() => proc.kill('SIGTERM'))` inside `run()`. Store the spawned process as `this.proc` so `write()` can access its stdin.

**Env forwarding**: Merge `opts?.env` with the inherited process env in `cp.spawn` options:
```typescript
const env = opts?.env ? { ...process.env, ...opts.env } : undefined;
cp.spawn(this.binaryPath, args, { cwd, env });
```

### 2. `src/extension.ts` — Wire up all components in `activate()`

Replace the current minimal implementation:

```typescript
import * as vscode from 'vscode';
import { CommandHandlers } from './commands';
import { WispCli } from './wispCli';
import { ManifestTreeDataProvider } from './views/manifestTree';
import { PrdTreeDataProvider } from './views/prdTree';
import { WispStatusBar } from './statusBar';
import { resolveWispRoot } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Wisp');
  context.subscriptions.push(outputChannel);

  const cliFactory = () => WispCli.resolve();
  const handlers = new CommandHandlers(cliFactory, outputChannel, context.extensionUri);

  // Resolve workspace root and keep it updated
  handlers.updateRoot(resolveWispRoot());
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      handlers.updateRoot(resolveWispRoot());
    }),
  );

  // Status bar
  const statusBar = new WispStatusBar(cliFactory);
  await statusBar.update(resolveWispRoot());
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wisp.binaryPath')) {
        void statusBar.update(resolveWispRoot());
      }
    }),
  );

  // Tree views
  const manifestProvider = new ManifestTreeDataProvider();
  const prdProvider = new PrdTreeDataProvider();
  context.subscriptions.push(manifestProvider, prdProvider);

  context.subscriptions.push(
    vscode.window.createTreeView('wispManifests', { treeDataProvider: manifestProvider }),
    vscode.window.createTreeView('wispPrds', { treeDataProvider: prdProvider }),
  );

  // Commands — all 8 (showVersion + 7 new)
  const reg = vscode.commands.registerCommand;
  context.subscriptions.push(
    reg('wisp.showVersion',    () => handlers.showVersion()),
    reg('wisp.orchestrate',    (uri?: vscode.Uri) => handlers.orchestrate(uri)),
    reg('wisp.pipeline',       (uri?: vscode.Uri) => handlers.pipeline(uri)),
    reg('wisp.run',            () => handlers.run()),
    reg('wisp.generatePrd',    () => handlers.generatePrd()),
    reg('wisp.generateContext',() => handlers.generateContext()),
    reg('wisp.monitor',        () => handlers.monitor()),
    reg('wisp.installSkills',  () => handlers.installSkills()),
  );
}

export function deactivate(): void {}
```

> **Note**: `WispStatusBar` must implement `vscode.Disposable` (add `dispose()` returning `this.item.dispose()`). Confirm it already does — it does per `src/statusBar.ts`.

### 3. `package.json` — Add all `contributes` entries

#### 3a. Commands (replace existing `contributes.commands`)

```jsonc
"commands": [
  { "command": "wisp.showVersion",     "title": "Wisp: Show Version" },
  { "command": "wisp.orchestrate",     "title": "Wisp: Orchestrate Manifest" },
  { "command": "wisp.pipeline",        "title": "Wisp: Run Pipeline" },
  { "command": "wisp.run",             "title": "Wisp: Run Agent" },
  { "command": "wisp.generatePrd",     "title": "Wisp: Generate PRD" },
  { "command": "wisp.generateContext", "title": "Wisp: Generate Context" },
  { "command": "wisp.monitor",         "title": "Wisp: Monitor Logs" },
  { "command": "wisp.installSkills",   "title": "Wisp: Install Skills" },
  { "command": "wisp.refreshManifests","title": "Wisp: Refresh Manifests", "icon": "$(refresh)" },
  { "command": "wisp.runManifest",     "title": "Wisp: Run Manifest", "icon": "$(play)" }
]
```

#### 3b. Views containers (Activity Bar)

```jsonc
"viewsContainers": {
  "activitybar": [
    {
      "id": "wispExplorer",
      "title": "Wisp",
      "icon": "resources/wisp.svg"
    }
  ]
}
```

#### 3c. Views

```jsonc
"views": {
  "wispExplorer": [
    {
      "id": "wispManifests",
      "name": "Manifests",
      "icon": "$(file-code)",
      "contextualTitle": "Wisp Manifests"
    },
    {
      "id": "wispPrds",
      "name": "PRDs",
      "icon": "$(book)",
      "contextualTitle": "Wisp PRDs"
    }
  ]
}
```

#### 3d. Menus

```jsonc
"menus": {
  "view/title": [
    {
      "command": "wisp.refreshManifests",
      "when": "view == wispManifests",
      "group": "navigation"
    }
  ],
  "view/item/context": [
    {
      "command": "wisp.runManifest",
      "when": "viewItem == manifestFile",
      "group": "inline"
    },
    {
      "command": "wisp.orchestrate",
      "when": "viewItem == manifestFile",
      "group": "wisp@1"
    },
    {
      "command": "wisp.pipeline",
      "when": "viewItem == prdFile",
      "group": "wisp@1"
    }
  ],
  "explorer/context": [
    {
      "command": "wisp.orchestrate",
      "when": "resourceExtname == .json && resourcePath =~ /manifests/",
      "group": "wisp@1"
    },
    {
      "command": "wisp.pipeline",
      "when": "resourceExtname == .md && resourcePath =~ /prds/",
      "group": "wisp@1"
    }
  ]
}
```

#### 3e. Configuration (add to existing `contributes.configuration.properties`)

```jsonc
"wisp.provider":          { "type": "string",  "enum": ["claude","gemini"], "default": "claude", "description": "AI provider" },
"wisp.maxParallel":       { "type": "number",  "default": 3,     "description": "Max concurrent PRD pipelines" },
"wisp.maxIterations":     { "type": "number",  "default": 10,    "description": "Ralph Loop iterations per agent" },
"wisp.baseBranch":        { "type": "string",  "default": "main","description": "Base branch for feature branches" },
"wisp.workDir":           { "type": "string",  "default": "",    "description": "Working directory for cloned repos" },
"wisp.useDevcontainer":   { "type": "boolean", "default": true,  "description": "Run agents in Dev Containers" },
"wisp.skipPr":            { "type": "boolean", "default": false, "description": "Dry-run: skip PR creation" },
"wisp.interactive":       { "type": "boolean", "default": false, "description": "Pause between agents for review" },
"wisp.logDir":            { "type": "string",  "default": "",    "description": "JSONL log output directory" },
"wisp.verbose":           { "type": "boolean", "default": false, "description": "Enable verbose CLI output" },
"wisp.evidenceAgents":    { "type": "string",  "default": "tester,secops,performance", "description": "Agents whose reports become PR comments" },
"wisp.claudeModel":       { "type": "string",  "default": "claude-sonnet-4-6", "description": "Default Claude model" },
"wisp.geminiModel":       { "type": "string",  "default": "gemini-2.5-pro",    "description": "Default Gemini model" },
"wisp.rootFolder":        { "type": "string",  "default": "",    "description": "Workspace folder name containing Wisp manifests (multi-root workspaces)" }
```

### 4. `resources/wisp.svg` — Activity Bar icon

Create `vscode-extension/resources/wisp.svg` with the SVG specified in `docs/architecture/vscode-02-cli-commands/design.md`. The file must be a 16×16 monochrome SVG using `currentColor` so it adapts to the active VSCode theme.

### 5. `src/commands.ts` — Minor: `pipeline()` URI parameter

The PRD requires `wisp.pipeline` to accept a URI when invoked from the file explorer context menu. The current `pipeline()` signature is `async pipeline(): Promise<void>`. Add the optional URI parameter:

```typescript
async pipeline(prdUri?: vscode.Uri): Promise<void> {
  let prdPath: string;
  if (prdUri) {
    prdPath = prdUri.fsPath;
  } else {
    const input = await vscode.window.showInputBox({ prompt: 'Path to PRD file', placeHolder: 'prds/my-feature.md' });
    if (!input) return;
    prdPath = input;
  }
  // ... rest unchanged
}
```

---

## Data Flow

```
User action (Command Palette / tree click / context menu)
  → vscode.commands.executeCommand('wisp.orchestrate', uri?)
    → CommandHandlers.orchestrate(uri?)
      → WispCli.resolve()              ← checks wisp.binaryPath or PATH
      → resolveEnv(root)               ← .env → .wisp → VSCode settings
      → cli.run(['orchestrate', '--manifest', path], cwd, onStdout, onStderr, { cancellationToken, env })
        → cp.spawn(binary, args, { cwd, env: { ...process.env, ...env } })
        → readline streams → onStdout callbacks → OutputChannel + ChatPanel
      → vscode.window.withProgress (notification with cancel button)
```

---

## File Listing — Final State

After developer implementation, the extension directory should contain:

```
vscode-extension/
├── src/
│   ├── extension.ts              ← REWRITE: wire all components
│   ├── wispCli.ts                ← EXTEND: cancellationToken, env, write()
│   ├── commands.ts               ← MINOR: add pipeline(uri?) param
│   ├── config.ts                 ✅ complete
│   ├── statusBar.ts              ✅ complete
│   ├── views/
│   │   ├── manifestTree.ts       ✅ complete
│   │   └── prdTree.ts            ✅ complete
│   ├── panels/
│   │   └── chatPanel.ts          ✅ complete (PRD 03 bonus)
│   ├── types/
│   │   └── messages.ts           ✅ complete
│   └── __tests__/                ✅ complete (7 test files)
├── resources/
│   └── wisp.svg                  ← CREATE: Activity Bar icon
├── package.json                  ← UPDATE: all contributes entries
├── esbuild.js                    ✅ no changes
├── jest.config.js                ✅ no changes
└── tsconfig.json                 ✅ no changes
```

---

## Key Design Decisions

### Single shared `OutputChannel`

One `OutputChannel("Wisp")` is created in `activate()` and shared across all commands via `CommandHandlers`. Rationale: multiple output channels would fragment log output; a single channel is the VSCode convention for extension output. The channel is shown/hidden automatically by each command.

### `cliFactory` pattern

`CommandHandlers` and `WispStatusBar` receive a `() => Promise<WispCli | null>` factory instead of a pre-resolved `WispCli` instance. Rationale: `WispCli.resolve()` may show UI (the "Install?" prompt) and must run lazily at command invocation time, not at activation time. Using a factory also makes testing easier — inject a mock factory returning a test double.

### No shell interpolation

All CLI args are passed as arrays to `cp.spawn`. No `shell: true`, no string concatenation. This is both a security requirement (PR reviewer check) and a correctness requirement (paths with spaces).

### `FileSystemWatcher` disposal

Both tree providers implement `dispose()` and are pushed to `context.subscriptions`. This ensures the `FileSystemWatcher` is released when the extension deactivates — preventing file descriptor leaks.

### Env priority chain

`resolveEnv()` merges env in order: `.env` file → `.wisp` JSON → VSCode settings. `WispCli.run()` then merges the result with `process.env` (process env as baseline, resolved env overrides). Auth tokens (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GEMINI_API_KEY`) flow from `.env` or process env only — never from VSCode settings, preventing accidental token exposure via `settings.json`.

---

## Testing Strategy

### Unit tests (already exist in `src/__tests__/`)

| Test file | Covers |
|-----------|--------|
| `commands.test.ts` | `CommandHandlers` methods with mocked `WispCli` and `vscode` |
| `statusBar.test.ts` | `WispStatusBar` found/not-found states |
| `manifestTree.test.ts` | `ManifestTreeDataProvider.getChildren()` with mocked `findFiles` |
| `prdTree.test.ts` | `PrdTreeDataProvider.getChildren()` |
| `config.test.ts` | `parseEnvFile`, `resolveEnv` env priority |
| `wispCli.test.ts` | `WispCli.resolve()` path resolution (existing, 9 tests) |

### Tests to add for new `wispCli` functionality

- `cancellationToken` fires → process receives SIGTERM
- `env` option passed → merged with `process.env` in spawn options
- `write()` writes to `proc.stdin`
- `runCapture()` forwards opts to `run()`

### Manual smoke tests

- Command Palette shows all 8 "Wisp:" commands
- Tree views appear in Activity Bar; manifest/PRD files listed correctly
- Status bar shows version; clicking opens Command Palette filtered to ">Wisp "
- Right-click on `manifests/**/*.json` shows "Wisp: Orchestrate Manifest"
- Right-click on `prds/**/*.md` shows "Wisp: Run Pipeline"

---

## Non-Functional Requirements

| Requirement | Design |
|-------------|--------|
| Performance: tree view < 500ms | `vscode.workspace.findFiles` is async; no blocking I/O in `getChildren` |
| Security: no shell injection | `cp.spawn(bin, argsArray, { shell: false })` always |
| Compatibility: VSCode 1.85+ | `engines.vscode: "^1.85.0"` unchanged; all APIs used exist in 1.85 |
| Zero new npm deps | All functionality via `vscode` API + Node.js builtins |
| Disposable leak prevention | All watchers, tree views, status bars pushed to `context.subscriptions` |
