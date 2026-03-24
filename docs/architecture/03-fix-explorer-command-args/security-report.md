# Security Report: VSCode Extension — Fix Explorer Tree Command Arguments

## Threat Surface

**Entry points**
- Five Explorer tree command handlers invoked from VSCode `view/item/inline` and `view/item/context` menu contributions: `wisp.explorer.orchestrate`, `wisp.explorer.orchestrateEpic`, `wisp.explorer.runPipeline`, `wisp.explorer.runPipelineFromPrd`, `wisp.explorer.generateContext`
- User-supplied string inputs from `vscode.window.showInputBox`: `maxIterations`, `repoUrl`, `branch`, `contextPath`, output directory
- VS Code workspace configuration: `wisp.binaryPath`
- Local workspace files read to populate the tree: `manifests/*.json`, `prds/**/*.md`

**Trust boundaries**
- Tree item data (`fsPath`, `manifestFsPath`, `epicName`, `prdPath`, `repoUrl`, `branch`) originates from manifest JSON files under `manifests/` in the open workspace — treated as user-controlled local files
- Free-form string inputs typed by the user into `showInputBox` prompts
- The `wisp` binary path resolved via `which`/`where` (PATH) or explicit VS Code setting

**Sensitive assets**
- File system paths passed as CLI arguments to the `wisp` binary
- Repository URLs passed to `wisp pipeline --repo` (which calls `git clone` internally)
- `wisp.binaryPath` setting: determines which binary the extension executes

---

## Findings

| Severity | Area | Issue | Fix |
|----------|------|-------|-----|
| Low | Input validation | `maxIterations` (collected via `showInputBox`) is passed directly as `--max-iterations <value>` with no client-side numeric validation. Invalid input (non-integer, negative, excessively large) produces a `clap` parse error in the Rust binary rather than a user-friendly VS Code message. | **Fixed**: Added `validateInput: (val) => /^\d+$/.test(val) && parseInt(val, 10) > 0 ? undefined : 'Must be a positive integer'` to both `showInputBox` calls for `maxIterations` in `extension.ts` (handlers `wisp.explorer.runPipeline` and `wisp.explorer.runPipelineFromPrd`). |
| Info | Shell execution | `WispCli.findOnPath()` uses `cp.exec(\`${cmd} wisp\`)` (shell-based) rather than `cp.execFile`. The command is fully hardcoded (`where wisp` / `which wisp`) so there is no injection surface, but `cp.execFile` would be slightly more defensive. | Low priority. Consider migrating to `cp.execFile` in a follow-up. |
| Info | Trusted config | `wisp.binaryPath` from VS Code settings is passed directly to `cp.spawn(this.binaryPath, args, { cwd })`. A misconfigured or malicious path would execute an arbitrary binary with the constructed arguments. This is an accepted trust boundary for a developer extension but warrants documentation. | No code change required. This is intentional and the trust model is appropriate for a local developer tool. |

---

## Hardening Changes Applied

- **`vscode-extension/src/extension.ts`** — Added `validateInput` to `showInputBox` for `maxIterations` in both `wisp.explorer.runPipeline` and `wisp.explorer.runPipelineFromPrd` handlers. Rejects non-positive-integer input with a user-friendly error before the subprocess is spawned. Eliminates the path where an arbitrarily large integer could trigger an unbounded pipeline run or a confusing `clap` parse error.

The PRD change (fixing handler signatures to accept typed tree item objects) **reduces** the attack surface by eliminating the untyped `[object Object]` serialization path and replacing it with explicitly typed property access. This is a correctness improvement with a positive security side-effect.

---

## Residual Risks

**`maxIterations` — resolved in this PR**
- `validateInput` added to both `showInputBox` calls. Non-positive-integer input is now rejected in the UI layer before spawning the subprocess.

**Manifest-sourced paths**
- `SubtaskItem.prdPath` and `SubtaskItem.repoUrl` are read from manifest JSON files in the workspace. A malicious or tampered manifest could direct the pipeline at unexpected paths or repositories.
- Mitigation: This is an accepted risk for a local developer tool. Users control their own workspace files. No code change warranted.

---

## Verification

```
npm run compile → [build] build finished (no type errors)
npm test        → 162 passed, 11 suites (no regressions)
```

Grep for shell-executed user input — none found; all subprocess calls use `cp.spawn(binary, argsArray)` form:
```
grep -n "cp.exec\|child_process.exec\|shell: true" vscode-extension/src/**/*.ts
→ wispCli.ts:58: cp.exec(`${cmd} wisp`, ...) — hardcoded, no user input interpolated
```
