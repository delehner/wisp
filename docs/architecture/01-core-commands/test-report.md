# Test Report: VSCode Extension — Core Command Palette Integration

## Summary
- Total tests: 87
- Passed: 87
- Failed: 0
- Statement coverage: 100%
- Branch coverage: 100%
- Function coverage: 100%
- Line coverage: 100%

## Test Suites

### Unit Tests — WispCli (`wispCli.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| resolve — workspace binaryPath configured | Returns WispCli when setting is set | ✅ |
| resolve — falls back to which/where | Invokes `which`/`where` when setting is empty | ✅ |
| resolve — binary not found | Returns null, shows install prompt | ✅ |
| resolve — user clicks Install | Opens install URL via `vscode.env.openExternal` | ✅ |
| resolve — win32 uses `where` | Uses `where` on Windows platform | ✅ |
| resolve — non-win32 uses `which` | Uses `which` on macOS/Linux | ✅ |
| isRunning false before run() | Correct initial state | ✅ |
| cancel() noop when not running | Does not throw | ✅ |
| cancel() sends SIGTERM | Kills proc, sets isRunning false | ✅ |
| run() rejects on proc error event | Promise rejects with error | ✅ |
| run() resolves to 1 when null close code | `code ?? 1` branch covered | ✅ |
| runCapture() returns stdout/stderr/code | Captures streamed output | ✅ |
| WispStatusBar dispose() | Does not throw | ✅ |

### Unit Tests — package.json contracts (`wispCli.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| activationEvents — onCommand:wisp.* | Activation on all wisp commands | ✅ |
| activationEvents — manifests/*.json | Workspace contains manifest | ✅ |
| activationEvents — prds/**/*.md | Workspace contains PRD | ✅ |
| contributes.commands — 11 commands | All FR commands declared | ✅ |
| all commands have non-empty title | Package.json completeness | ✅ |

### Unit Tests — Command Utilities (`commandUtils.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| KNOWN_AGENTS contains all 14 agents | FR-3 agent list completeness | ✅ |
| pickManifestFile — QuickPick on match | Shows picker when files found | ✅ |
| pickManifestFile — fallback InputBox | Falls back to manual input | ✅ |
| pickPrdFile — QuickPick on match | Shows picker when PRD files found | ✅ |
| pickPrdFile — fallback InputBox | Falls back to manual input | ✅ |
| runWithOutput — stdout/stderr piping | Lines appear in Output Channel | ✅ |
| runWithOutput — already-running guard | Returns 1 and shows warning | ✅ |
| registerInstallSkillsCommand — registers | Command registered in extension | ✅ |
| registerInstallSkillsCommand — correct args | `['install', 'skills']` | ✅ |
| registerInstallSkillsCommand — success notification | Shows info on exit 0 | ✅ |
| registerInstallSkillsCommand — error notification | Shows error on exit non-zero | ✅ |
| registerInstallSkillsCommand — no workspace | Shows error message | ✅ |
| registerInstallSkillsCommand — WispCli null | Returns early, no spawn | ✅ |
| registerUpdateCommand — registers | Command registered | ✅ |
| registerUpdateCommand — correct args | `['update']` | ✅ |
| registerUpdateCommand — withProgress | Wraps in progress notification | ✅ |
| registerUpdateCommand — success notification | Shows info on exit 0 | ✅ |
| registerUpdateCommand — error notification | Shows error on exit non-zero | ✅ |
| registerUpdateCommand — WispCli null | Returns early, no withProgress | ✅ |
| registerUpdateCommand — no workspace folder | Falls back to process.cwd() | ✅ |

### Unit Tests — Orchestrate Command (`orchestrate.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| registers wisp.orchestrate | FR-1 command registration | ✅ |
| builds correct args | `['orchestrate', '--manifest', path]` | ✅ |
| manifest picker cancelled | No spawn | ✅ |
| WispCli.resolve() null after manifest picked | No spawn | ✅ |
| no workspace folder open | Error message shown | ✅ |

### Unit Tests — Pipeline Command (`pipeline.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| registers wisp.pipeline | FR-2 command registration | ✅ |
| builds correct args | `['pipeline', '--prd', p, '--repo', r, '--branch', b]` | ✅ |
| no workspace folder open | Error message shown | ✅ |
| prd picker cancelled | No spawn | ✅ |
| branch input cancelled | No spawn | ✅ |
| WispCli.resolve() null after inputs | No spawn | ✅ |
| validates repo URL | Rejects non-https/git@ URLs | ✅ |
| uses "main" fallback for empty branch | Empty string → `'main'` in args | ✅ |

### Unit Tests — Run Command (`run.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| registers wisp.run | FR-3 command registration | ✅ |
| shows all 14 agents in QuickPick | FR-3 agent list | ✅ |
| no workspace folder open | Error message shown | ✅ |
| workdir input cancelled | No spawn | ✅ |
| prd picker cancelled | No spawn | ✅ |
| WispCli.resolve() null after inputs | No spawn | ✅ |
| builds correct args | `['run', '--agent', a, '--workdir', w, '--prd', p]` | ✅ |

### Unit Tests — Generate Commands (`generate.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| registers wisp.generatePrd | FR-4 command registration | ✅ |
| builds args with single repo URL | Array args, no shell interpolation | ✅ |
| builds args with multiple repo URLs | Separate `--repo` flags per URL | ✅ |
| WispCli.resolve() null after inputs (generatePrd) | No spawn | ✅ |
| description input cancelled | No spawn | ✅ |
| no workspace folder open (generatePrd) | Error message shown | ✅ |
| registers wisp.generateContext | FR-5 command registration | ✅ |
| builds args: generate context | `['generate', 'context', '--repo', r, '--branch', b]` | ✅ |
| no workspace folder open (generateContext) | Error message shown | ✅ |
| WispCli.resolve() null after inputs (generateContext) | No spawn | ✅ |
| repo URL input cancelled | No spawn | ✅ |
| branch input cancelled (undefined) | No spawn | ✅ |
| empty branch defaults to main | `|| 'main'` fallback | ✅ |

### Unit Tests — Monitor Command (`monitor.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| registers wisp.monitor | FR-6 command registration | ✅ |
| WispCli.resolve() null | Returns early, no spawn | ✅ |
| no sessions — info message | Shows guidance when no logs exist | ✅ |
| sessions exist — shows QuickPick | Lists sessions for selection | ✅ |
| builds correct args on selection | `['monitor', '--session', id]` | ✅ |
| falls back to process.cwd() — no workspace | Handles missing workspaceFolders | ✅ |

## Coverage Report

| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| statusBar.ts | 100% | 100% | 100% | 100% |
| wispCli.ts | 100% | 100% | 100% | 100% |
| commands/generate.ts | 100% | 100% | 100% | 100% |
| commands/monitor.ts | 100% | 100% | 100% | 100% |
| commands/orchestrate.ts | 100% | 100% | 100% | 100% |
| commands/pipeline.ts | 100% | 100% | 100% | 100% |
| commands/run.ts | 100% | 100% | 100% | 100% |
| commands/utils.ts | 100% | 100% | 100% | 100% |
| **All files** | **100%** | **100%** | **100%** | **100%** |

## Bugs Found
- None. All PRD requirements were correctly implemented by the Developer agent.

## Recommendations
- Three tests were added to cover previously-missing branches (`monitor.ts:14`, `pipeline.ts:55`, `utils.ts:127`) — nullish-coalescing and empty-string fallbacks — raising branch coverage from 95.38% to 100%.
- Consider adding `statusBar.setRunning()` / `setIdle()` behavioral tests if the status bar gains more logic in future PRDs.
