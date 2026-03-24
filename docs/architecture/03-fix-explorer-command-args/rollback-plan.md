# Rollback Plan: VSCode Extension — Fix Explorer Tree Command Arguments

## Risk Assessment

| Dimension | Rollback Needed | Complexity | Data Loss Risk |
|-----------|----------------|------------|----------------|
| Code | Yes — revert merge or republish previous `.vsix` | Low | None |
| Database | No | — | — |
| Infrastructure | No | — | — |
| Configuration | No | — | — |
| Feature Flags | No | — | — |

**Summary**: This PR is a pure TypeScript bug fix that corrects argument extraction in five VS Code command handlers. There are no schema changes, no new environment variables, no infrastructure provisioning, and no data written at deploy time. Rollback is fast and safe.

## Feature Flags

None recommended. The changed behavior was always broken (tree item objects were serialized as `"[object Object]"` and passed to the CLI). There is no valid "old behavior" to preserve behind a flag.

## Rollback Procedures

### Quick Rollback — Republish Previous Extension Version (recommended)

Use this when the new marketplace version has a critical defect and you need to recover users immediately without touching the `main` branch.

1. Find the last known-good `.vsix` in [GitHub Releases](https://github.com/delehner/wisp/releases) (e.g., `wisp-ai-0.1.2.vsix`).
2. Republish it to the VS Code Marketplace:
   ```bash
   npx vsce publish --packagePath wisp-ai-0.1.2.vsix --pat "$VSCE_PAT"
   ```
3. Verify the Marketplace listing rolls back to the previous version (~5 minutes).
4. Tag a corrected version for tracking (do **not** delete or reuse tags):
   ```bash
   git tag vscode-v0.1.5   # next patch after the bad release
   git push origin vscode-v0.1.5
   ```
5. Verify: Install the republished version in a clean VS Code instance and confirm the regression is gone.
6. Expected recovery time: **~10 minutes**

### Full Rollback — Revert Merge Commit

Use this if the quick rollback is insufficient or if you need to remove the code from `main`.

1. Identify the merge commit SHA on `main`:
   ```bash
   git log --oneline main | head -10
   ```
2. Revert the merge commit:
   ```bash
   git revert -m 1 <merge-sha>
   git push origin main
   ```
3. Trigger the publish workflow by creating a new patch tag (bumped past the bad version):
   ```bash
   # Bump version in package.json first
   git add vscode-extension/package.json vscode-extension/package-lock.json
   git commit -m "chore(vscode-extension): bump version to 0.1.5"
   git push origin main
   git tag vscode-v0.1.5
   git push origin vscode-v0.1.5
   ```
4. Monitor the `Publish VSCode Extension` workflow in GitHub Actions.
5. Verify: Marketplace shows `0.1.5` and the `[object Object]` error is no longer reproducible.
6. Expected recovery time: **~20 minutes**

### Emergency Workaround (no deploy required)

Users experiencing the `[object Object]` error can use Command Palette flows instead of the Explorer tree until the fix (or rollback) is published:

- `Ctrl+Shift+P` → "Wisp AI: Orchestrate" → file picker selects the manifest
- `Ctrl+Shift+P` → "Wisp AI: Run Pipeline" → file picker selects the PRD

These paths call `pickManifestFile()` / `pickPrdFile()` and are **unaffected** by this bug.

## Monitoring & Triggers

| Signal | Threshold | Action |
|--------|-----------|--------|
| GitHub Issues: new `vscode-extension` bug reports mentioning `[object Object]` | ≥1 report within 24 h of release | Verify reproduction, trigger quick rollback if confirmed |
| VS Code Marketplace ratings drop | ≥2 new 1-star reviews citing broken Explorer | Investigate, trigger quick rollback |
| CI `Test` step fails on `main` after merge | Any failure | Do not publish; revert merge immediately |
| Publish workflow fails at "Publish to VS Code Marketplace" | Any failure | Check `VSCE_PAT` expiry; rotate secret if needed |

## Blast Radius

- **Users affected by this deploy**: All Wisp AI VS Code extension users. The fix corrects Explorer tree commands that were previously always broken.
- **Users affected by rollback**: Same set. Rollback returns them to the prior broken state; the Command Palette workaround (above) continues to work.
- **Dependent systems**: None. The Rust `wisp` CLI binary is unchanged. No server-side components exist.
- **Data created between deploy and rollback**: None. The extension only spawns CLI subprocesses; it does not persist any user data.

## Post-Rollback Checklist

- [ ] Verify VS Code Marketplace shows the intended version
- [ ] Install from Marketplace in a clean VS Code instance and confirm no regressions
- [ ] Post a comment on the PR (or open a new issue) describing the defect that triggered rollback
- [ ] Notify any users who reported issues via GitHub Issues
- [ ] Create a fix-forward branch and plan a corrected release
