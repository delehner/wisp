# Infrastructure: VSCode Extension — Fix Explorer Tree Command Arguments

## Runtime Topology

- **Component**: VSCode extension (`wisp-ai`) — a client-side extension running in the VSCode extension host process
- **Runtime**: Node.js (VSCode extension host); no server, no container, no network service
- **External dependency**: `wisp` binary on the user's `PATH` — invoked via `child_process.spawn` from `wispCli.ts`
- **No new runtime components introduced by this PRD**

## Environment Contract

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PATH` | Yes | System default | Must include the directory containing the `wisp` binary |

No new environment variables are introduced or required by this fix. The extension reads the `wisp.binaryPath` VSCode setting to locate the CLI; `PATH` resolution is the fallback. Neither was changed by this PRD.

## Deployment Requirements

- **Build**: `npm run compile` (esbuild bundle → `out/extension.js`) — unchanged; passes cleanly
- **Runtime**: VSCode ≥ 1.85.0 (as declared in `package.json` `engines.vscode`)
- **Packaging**: `vsce package` produces a `.vsix` for marketplace publish — no changes to manifest, icons, or contribution points affect packaging
- **Migration/seed**: None — no schema, no state migration, no persistent storage changes

## Infra Changes Applied

None. This PRD is a pure TypeScript correctness fix: handler parameter types in `vscode-extension/src/extension.ts` were updated to accept typed tree item objects (`ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFileItem`) and extract the correct string properties (`.fsPath`, `.manifestFsPath`, `.epicName`, `.prdPath`, `.repoUrl`, `.branch`). No infrastructure files were modified.

## Rollout Risks

| Risk | Mitigation / Rollback |
|------|-----------------------|
| None identified | N/A — fix is scoped to a single TypeScript file with no runtime infrastructure surface |

All 162 tests pass (`npm test`). Bundle size is unchanged at 37,221 bytes. No new runtime dependencies, environment variables, network calls, or storage requirements were introduced.
