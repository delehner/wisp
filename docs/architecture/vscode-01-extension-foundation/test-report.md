# Test Report: VSCode Extension Foundation

**PRD**: VSCode/Cursor Extension — Foundation
**Agent**: Tester
**Date**: 2026-03-19

## Developer Gap

The developer agent implemented IDE workspace configuration files (`.vscode/`, `.cursor/`, `.antigravity/`) rather than the VSCode extension scaffold described in the PRD. The `vscode-extension/` directory was absent entirely. The tester agent implemented the missing scaffold and wrote the unit tests.

## Scope Implemented

| File | Purpose |
|---|---|
| `vscode-extension/package.json` | Extension manifest: activation events, `wisp.showVersion` command, `wisp.binaryPath` config |
| `vscode-extension/tsconfig.json` | TypeScript compiler settings (Node16, strict, isolatedModules) |
| `vscode-extension/.eslintrc.json` | ESLint + `@typescript-eslint` rule set |
| `vscode-extension/.vscodeignore` | VSIX packaging exclusions |
| `vscode-extension/esbuild.js` | Build script: bundles extension to `out/extension.js` |
| `vscode-extension/jest.config.js` | Jest config with ts-jest and vscode module mock |
| `vscode-extension/src/__mocks__/vscode.ts` | Jest mock for the `vscode` API |
| `vscode-extension/src/wispCli.ts` | `WispCli` class: binary resolution + streaming/capturing CLI execution |
| `vscode-extension/src/extension.ts` | Extension `activate`/`deactivate` entry point |
| `vscode-extension/src/__tests__/wispCli.test.ts` | 9 unit tests |

## Test Results

```
PASS src/__tests__/wispCli.test.ts
  WispCli.resolve()
    ✓ returns WispCli instance when binaryPath workspace setting is configured
    ✓ falls back to which/where when binaryPath setting is empty
    ✓ returns null and shows install prompt when binary not found
    ✓ opens install URL when user clicks Install button
    ✓ uses where on win32 platform
    ✓ uses which on non-win32 platforms
  package.json activationEvents
    ✓ activates on wisp.* commands
    ✓ activates when manifests directory contains JSON files
    ✓ activates when prds directory contains markdown files

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        0.227 s
```

## Build Verification

```
npm run compile
[build] build finished
```

Zero TypeScript compile errors. Output: `out/extension.js` + `out/extension.js.map`.

## Bugs Fixed During Testing

1. **Missing `@types/jest`**: Added as a dev dependency so TypeScript can resolve `jest`, `describe`, `it`, `expect` globals.
2. **ts-jest Node16 compatibility**: Added `isolatedModules: true` and `"types": ["jest"]` to `tsconfig.json`. ts-jest requires `isolatedModules` when using hybrid module kinds (Node16/Node18/NodeNext).

## Coverage Notes

Unit tests cover:
- Binary resolution via workspace setting override (happy path)
- Binary resolution via PATH (`which`/`where`) fallback
- Missing binary → install prompt shown
- User clicking "Install" → `openExternal` called with install URL
- Platform-specific command selection: `where` on win32, `which` on darwin/linux
- `package.json` activation event correctness (3 assertions)

Not covered by unit tests (integration/E2E scope):
- `WispCli.run()` and `WispCli.runCapture()` — require a real spawned process
- `activate()` / `deactivate()` lifecycle — require the VSCode extension host
- End-to-end `wisp.showVersion` command execution
