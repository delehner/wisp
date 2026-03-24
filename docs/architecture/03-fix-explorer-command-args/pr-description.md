## Summary

- Fixes all five Explorer tree-view command handlers in `vscode-extension/src/extension.ts` to correctly extract string properties from the VSCode tree item objects passed by the IDE, eliminating `Error: failed to read manifest: [object Object]` and `Error: failed to read PRD: [object Object]` errors.
- Adds 25 targeted unit tests covering property extraction, fallback behaviour, cancellation paths, and the `[object Object]` regression.

## Changes

- `vscode-extension/src/extension.ts`: All five Explorer command handlers updated to accept typed item objects (`ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFileItem`) and read the correct properties (`.fsPath`, `.manifestFsPath`, `.epicName`, `.prdPath`, `.repoUrl`, `.branch`) instead of passing the raw object to the CLI subprocess.
- `vscode-extension/src/__tests__/explorerCommands.test.ts`: New test file with 25 tests for all five Explorer commands.
- `docs/architecture/03-fix-explorer-command-args/architecture.md`: Architecture document describing root cause, component table, and implementation decisions.

## Architecture Decisions

- **Handler-side fix only** — the root cause is the parameter types in the handlers; no `package.json` `arguments` arrays or `items.ts` changes are needed (per PRD).
- **Specific typed parameters** — handlers use `ManifestItem`, `EpicItem`, etc. rather than `any` or duck-typed `{ fsPath: string }`, providing compile-time safety for future refactors.
- `wisp.explorer.runPipelineFromPrd` and `wisp.explorer.generatePrd` were already correct on the branch; only type verification was performed for those two.

## Testing

- Unit tests: 25 new tests added in `explorerCommands.test.ts`
- Integration tests: manual verification via Extension Development Host not required for CI (all handler logic covered by unit tests)
- Coverage: 137 pre-existing tests + 25 new = **162 tests**, 11 suites — all passing

## Checklist

- [x] Tests pass (`npm test` — 162 passed, 11 suites)
- [x] Build succeeds (`npm run compile` — `[build] build finished`)
- [x] No linter errors (`npm run lint` — clean)
- [x] Architecture doc reviewed
- [x] Design spec followed (logic-only fix, no UI)
- [x] Accessibility verified (no UI changes)
- [x] Security considerations addressed (no new attack surface)

## Review Notes

The fix was already implemented on the branch before the pipeline started (committed in a prior session). The architect agent confirmed this in iteration 1 and the developer agent verified each handler. The tester agent added the unit test coverage. This PR is ready for merge.
