# Rollback Plan: VSCode/Cursor Extension — Foundation

## Overview

This PRD is **entirely additive**: it introduces a new `vscode-extension/` TypeScript project, IDE workspace configuration files (`.vscode/`, `.cursor/`, `.antigravity/`), CI workflow additions, and documentation. There are no database migrations, no server-side infrastructure changes, and no modifications to the Rust binary or its public interface.

Rollback is straightforward: revert the commits introduced by this branch.

---

## Risk Assessment

| Dimension | Rollback Needed | Complexity | Data Loss Risk |
|-----------|----------------|------------|----------------|
| Code (vscode-extension/) | Yes — remove new directory | Low (revert commits) | None |
| Code (IDE config files) | Yes — remove config files | Low (revert commits) | None |
| Database | No | — | — |
| Infrastructure | No | — | — |
| CI Workflow (ci.yml) | Yes — remove vscode-extension job | Low (revert file) | None |
| Configuration (env vars) | No | — | — |
| VS Code settings (wisp.binaryPath) | Cosmetic — removed on rollback | None | None |

---

## Feature Flags

No runtime feature flags were introduced. The extension activates on workspace conditions (`activationEvents` in `package.json`). There is no flag-gated behavior.

**Recommendation for future PRDs**: When adding WebView panels or pipeline invocation from the extension (PRD 03+), consider gating behind a `wisp.enableExperimentalCommands` setting defaulting to `false` to allow a staged rollout.

---

## Rollback Procedures

### Quick Rollback — Revert Merge Commit

If the feature branch was merged via a merge commit:

```bash
# Find the merge commit SHA
git log --oneline --merges | head -5

# Revert the merge commit (creates a new revert commit — safe, no history rewrite)
git revert -m 1 <merge-commit-sha>

# Push to trigger CI on the revert
git push origin main
```

Expected recovery time: **< 5 minutes** (revert + CI run).

### Full Rollback — Revert Individual Commits

If the feature branch was squash-merged or the individual commits need reverting:

```bash
# Commits introduced by this PRD (most recent first):
# f8eb74c  fix(vscode-extension): align @types/jest with jest 29, add @types/node, upgrade esbuild
# 65604a4  test(vscode-extension): add extension scaffold and unit tests for WispCli
# e14dfba  feat(ide): add VSCode, Cursor, and Antigravity workspace configuration
# (plus any uncommitted ci.yml / devops.md changes committed at rollback time)

# Revert each commit in reverse order
git revert f8eb74c --no-edit
git revert 65604a4 --no-edit
git revert e14dfba --no-edit

git push origin main
```

Expected recovery time: **< 10 minutes**.

### Manual File Removal (emergency, last resort)

If revert conflicts are unresolvable, remove the new artifacts directly:

```bash
# Remove the entire extension directory
rm -rf vscode-extension/

# Remove IDE workspace config files
rm -rf .vscode/ .cursor/rules/architecture.mdc .antigravity/ wisp.code-workspace

# Restore .gitignore to exclude .vscode/settings.json
# (add back the line: .vscode/settings.json)

# Restore ci.yml to pre-PRD state (remove vscode-extension job and path triggers)
git checkout c24f258 -- .github/workflows/ci.yml

# Remove docs artifacts
rm -rf docs/architecture/vscode-01-extension-foundation/

git add -p   # review each change before staging
git commit -m "revert(vscode-extension): remove extension scaffold (manual rollback)"
git push origin main
```

Expected recovery time: **< 15 minutes**.

---

## Post-Rollback Verification

Run after any rollback procedure:

```bash
# Verify vscode-extension/ is gone
ls vscode-extension/ 2>/dev/null && echo "NOT CLEAN" || echo "OK"

# Verify Rust build still passes (extension changes should not affect Rust)
cargo build
cargo test
cargo clippy -- -D warnings

# Verify CI workflow no longer references vscode-extension
grep -c "vscode-extension" .github/workflows/ci.yml
# Expected: 0
```

---

## Monitoring & Triggers

| Signal | Threshold | Action |
|--------|-----------|--------|
| CI `vscode-extension` job failure | Any failure on `main` | Investigate immediately; revert if root cause is non-trivial |
| Bundle size regression | `out/extension.js` > 500 KB | Audit `package.json` `dependencies` (must be empty); revert if production dep added accidentally |
| `npm audit` new vulnerabilities | Any high/critical | Patch dependency; if unfixable, revert until patched |
| Extension fails to activate | Confirmed by manual smoke-test | Investigate `activationEvents` and `main` field; rollback if unfixable before release |

---

## Blast Radius

- **Users affected by deploy**: Zero — no production service is modified. The extension is not yet published to the VS Code Marketplace. Only developers who manually install the `.vsix` are affected.
- **Users affected by rollback**: Zero — same reasoning. The extension has no server-side component and no data storage.
- **Dependent systems**: None. The Rust `wisp` binary is unchanged. The extension calls the CLI as a subprocess; reverting the extension does not affect the CLI.
- **CI**: Rollback removes the `vscode-extension` CI job and path triggers from `ci.yml`. Existing Rust CI job is unaffected.
- **Data created between deploy and rollback**: None. The extension stores no data; it only reads `wisp.binaryPath` from VS Code user settings. Rolling back the extension does not remove user settings (VS Code manages those independently).

---

## Post-Rollback Checklist

- [ ] Verify `cargo build` and `cargo test` still pass after rollback
- [ ] Verify `vscode-extension/` directory is absent
- [ ] Verify CI workflow `vscode-extension` job is absent from `ci.yml`
- [ ] Confirm no `.vsix` was published to the Marketplace (N/A for this foundation PRD — publishing is out of scope)
- [ ] Notify stakeholders of rollback decision
- [ ] Create tracking issue with root cause and fix-forward timeline
