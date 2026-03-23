# Test Report: VSCode Extension Marketplace Publishing Pipeline

## Summary

- Total tests: 0 automated (GitHub Actions workflows have no unit-testable logic)
- Passed: N/A
- Failed: N/A
- Coverage: N/A
- Static review: **All 4 functional requirements verified ✅**

GitHub Actions workflows cannot be unit-tested — they are validated by executing them against real infrastructure. This report documents the static review findings and the manual test plan that must be run before this workflow is relied upon for production releases.

---

## Static Review: Requirements Checklist

### FR-1: Publish Workflow

| Acceptance Criterion | Status | Evidence |
|---------------------|--------|---------|
| Triggers on `push` with `tags: ['vscode-v*']` | ✅ | Lines 3–6 of `publish-vscode.yml` |
| Job runs on `ubuntu-latest` | ✅ | Line 13 |
| Steps: checkout → Node 20 → npm ci → compile → lint → test → vsce package → vsce publish → upload VSIX | ✅ | Lines 19–63 in order |
| `vsce publish` uses `VSCE_PAT` secret | ✅ | `--pat ${{ secrets.VSCE_PAT }}` on line 55 |
| Job fails if any step fails (no spurious `continue-on-error`) | ✅ | `continue-on-error: true` only on Open VSX step |
| Working directory is `vscode-extension/` for all npm/vsce steps | ✅ | `defaults.run.working-directory: vscode-extension` lines 15–17 |

### FR-2: GitHub Release Creation

| Acceptance Criterion | Status | Evidence |
|---------------------|--------|---------|
| `softprops/action-gh-release@v2` creates release for the tag | ✅ | Line 58 |
| Release title: `VSCode Extension v<version>` | ✅ | `name: "VSCode Extension v${{ env.PKG_VERSION }}"` line 60 |
| VSIX file (`wisp-*.vsix`) attached to release | ✅ | `files: vscode-extension/wisp-*.vsix` line 61 |
| Pre-release flag set for tags with suffix (e.g. `-beta`) | ✅ | `prerelease: ${{ contains(github.ref_name, '-') }}` line 62 |

### FR-3: Open VSX Publish (Optional)

| Acceptance Criterion | Status | Evidence |
|---------------------|--------|---------|
| Step runs only when `secrets.OVSX_PAT != ''` | ✅ | `if: secrets.OVSX_PAT != ''` line 66 |
| Uses `ovsx publish` with the packaged VSIX | ✅ | `npx ovsx publish wisp-*.vsix` line 68 |
| Step failure does not block overall workflow | ✅ | `continue-on-error: true` line 67 |

### FR-4: Version Validation

| Acceptance Criterion | Status | Evidence |
|---------------------|--------|---------|
| Extract tag version: strip `vscode-v` prefix from `GITHUB_REF_NAME` | ✅ | `${GITHUB_REF_NAME#vscode-v}` line 42 |
| Extract package.json version via `node -p` | ✅ | `node -p "require('./package.json').version"` line 43 |
| Fail with clear error if versions mismatch | ✅ | `echo "Error: tag version..."` + `exit 1` lines 44–48 |
| `PKG_VERSION` exported to env for reuse in release title | ✅ | `echo "PKG_VERSION=..." >> "$GITHUB_ENV"` line 49 |

### Security

| Requirement | Status | Evidence |
|------------|--------|---------|
| `permissions: contents: write` at workflow level | ✅ | Lines 8–9 (workflow-level, not job-level) |
| Secrets not echoed in logs | ✅ | GHA automatically masks secret values in output |
| `VSCE_PAT` only used in publish step | ✅ | Referenced only in `npx vsce publish` step |
| `OVSX_PAT` only used in Open VSX step | ✅ | Referenced only in optional Open VSX step |

---

## Bugs Found

None. The workflow correctly implements all acceptance criteria.

---

## Manual Test Plan

Because GitHub Actions workflows must be run against real infrastructure to validate end-to-end behavior, the following manual tests must be executed before relying on this workflow for production releases. Run these against a **fork** of the repository to avoid publishing to the real Marketplace.

### Prerequisites

- Fork `delehner/wisp` to a personal account
- Configure secrets in the fork: `VSCE_PAT` (a valid Azure DevOps PAT with Marketplace publish scope), optionally `OVSX_PAT`
- Ensure the fork has a registered publisher on marketplace.visualstudio.com (can use a test publisher)

### Test Cases

#### TC-1: Happy Path — Stable Release

**Goal**: Full workflow succeeds for a stable tag.

Steps:
1. In the fork, set `vscode-extension/package.json` `version` to `0.1.0-test` (use a fake version that won't clash)
2. Commit and push to `main`
3. Push tag: `git tag vscode-v0.1.0-test && git push origin vscode-v0.1.0-test`

Expected:
- Workflow triggers automatically
- All CI steps (compile, lint, test) pass
- Version validation passes (tag `0.1.0-test` matches `package.json`)
- `vsce package` produces `wisp-0.1.0-test.vsix`
- `vsce publish` publishes to Marketplace (or fails with PAT/publisher error if fork publisher is not configured — that is acceptable; the step must be reached)
- GitHub Release `VSCode Extension v0.1.0-test` is created with the VSIX attached
- Release is **not** marked as pre-release (no `-` suffix)

#### TC-2: Pre-release Tag

**Goal**: Release is correctly marked as pre-release for tags with a hyphen suffix.

Steps:
1. Set `package.json` `version` to `0.2.0-beta.1`
2. Push tag: `git tag vscode-v0.2.0-beta.1 && git push origin vscode-v0.2.0-beta.1`

Expected:
- Version validation passes (`0.2.0-beta.1` matches `package.json`)
- GitHub Release is created and **is** marked as pre-release

#### TC-3: Version Mismatch — Workflow Fails

**Goal**: Workflow aborts early when tag and `package.json` versions differ.

Steps:
1. Keep `package.json` `version` as `0.1.0`
2. Push tag: `git tag vscode-v9.9.9 && git push origin vscode-v9.9.9`

Expected:
- Workflow fails at the `Validate version matches tag` step
- Error message in logs: `Error: tag version (9.9.9) does not match package.json version (0.1.0)`
- No VSIX is packaged or published
- No GitHub Release is created

#### TC-4: Open VSX Conditional

**Goal**: Open VSX step skips when `OVSX_PAT` is not configured.

Steps:
1. Ensure the fork has **no** `OVSX_PAT` secret set
2. Run TC-1

Expected:
- `Publish to Open VSX Registry` step is **skipped** (not failed)
- All other steps complete normally

#### TC-5: CI Gate — Test Failure Blocks Publish

**Goal**: A failing test prevents publishing.

Steps:
1. Introduce a deliberate test failure in `vscode-extension/src/`
2. Push tag triggering the workflow

Expected:
- Workflow fails at the `Test` step
- `vsce package` and `vsce publish` steps are **never reached**
- No GitHub Release is created

---

## Recommendations

- Run TC-1 through TC-4 before cutting the first real `vscode-v*` release
- Consider adding a `workflow_dispatch` trigger (with an optional dry-run input) so the workflow can be manually triggered without a tag push during initial setup validation
- Document the Azure DevOps PAT rotation schedule (1 year expiry recommended per PRD risk register)
