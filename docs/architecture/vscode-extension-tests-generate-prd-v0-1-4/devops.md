# DevOps: VSCode Extension Tests — wisp.explorer.generatePrd (v0.1.4)

## CI/CD Coverage

### Checks In Place

| Check | Job | Trigger |
|-------|-----|---------|
| TypeScript compile | `vscode-extension` | `vscode-extension/**` path filter |
| ESLint | `vscode-extension` | `vscode-extension/**` path filter |
| Jest (all 166 tests) | `vscode-extension` | `vscode-extension/**` path filter |
| Node 20, npm ci (clean install) | `vscode-extension` | `vscode-extension/**` path filter |

Both modified files (`src/extension.ts`, `src/__tests__/explorerCommands.test.ts`) live under `vscode-extension/` and are covered by the existing path filter.

### Gaps Found

None. The existing `ci.yml` `vscode-extension` job provides full coverage for this change:

- **Compile step** catches any TypeScript errors in the `item?: ManifestItem` signature change.
- **Lint step** enforces code style on the new test additions.
- **Test step** runs all 166 tests including the 4 new FR-1 through FR-4 cases.

No CI/CD workflow changes are required.

## Automation Changes Applied

None — no scripts or workflows were modified. The existing pipeline is sufficient for this change.

## Release Runbook

### Pre-Deploy Checklist

- [ ] PR passes all CI checks (compile, lint, test) on the `delehner/vscode-extension-tests` branch
- [ ] `npm test` exits 0 locally — 166 tests, 0 failures
- [ ] Review diff is limited to `src/extension.ts` (2 lines) and `src/__tests__/explorerCommands.test.ts` (+4 tests)
- [ ] Reviewer has approved the PR

### Deploy Steps

This change ships with the next VSCode extension version bump. It is a test-only + handler-signature change with no user-visible behavior change beyond enabling the view/title button path that was already registered in `package.json`.

1. Merge PR into `main`
2. If a version release is intended: bump `version` in `vscode-extension/package.json`, commit, tag
3. The extension is packaged with `vsce package` and published via `vsce publish` (manual step, not automated in CI)

### Post-Deploy Verification

1. Install the new `.vsix` locally: `code --install-extension wisp-*.vsix`
2. Open a workspace in VSCode
3. Click the **Generate PRD** button in the Wisp Explorer view title bar (no tree selection) — confirm an InputBox appears asking for manifest path
4. Confirm cancelling the InputBox returns silently with no error
5. Confirm providing a manifest path proceeds to the remaining prompts
6. Confirm right-clicking a manifest tree item still works as before (item-present path)

### Rollback Steps

If a regression is introduced:

1. Revert the merge commit on `main`: `git revert <merge-sha>`
2. Publish the previous `.vsix` artifact: `vsce publish` with the reverted code
3. Alternatively, VSCode Marketplace allows unpublishing or rolling back to a previous version through the publisher dashboard

## Monitoring & Alerts

### Signals to Watch

- CI check status on every PR touching `vscode-extension/**` — failures indicate regressions
- Test count in CI logs: must be ≥ 166; a drop signals a test was accidentally deleted
- Test runtime: currently ~2.1 s; a spike above 10 s would indicate a hanging mock or async leak

### Failure Indicators

| Indicator | Likely Cause | Action |
|-----------|-------------|--------|
| `showInputBox` mock call count mismatch | `promptGeneratePrdArgs` prompt order changed | Update mock sequences in FR-1/FR-2 tests |
| `cp.spawn` called unexpectedly in FR-2/FR-3 | Early-return logic broken in handler | Check `item?.fsPath` optional chaining and null-check in `promptGeneratePrdArgs` |
| TypeScript error on `item?` | Type import or interface changed | Verify `ManifestItem` is still exported from tree provider |
| All tests pass but 162 (not 166) | New tests accidentally excluded | Check describe block nesting in `explorerCommands.test.ts` |
