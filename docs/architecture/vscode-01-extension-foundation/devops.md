# DevOps: VSCode/Cursor Extension — Foundation

## CI/CD Coverage

### Checks in Place

| Job | Trigger | Steps |
|-----|---------|-------|
| `check` (Rust) | `src/**`, `Cargo.toml`, `Cargo.lock`, `.github/workflows/**` | fmt, clippy, test, build |
| `vscode-extension` | `vscode-extension/**`, `.github/workflows/**` | npm ci, compile, lint, test |

Both jobs run on `push` to `main` and on all `pull_request` events matching the path filters.

### Gaps Addressed (DevOps)

- **Workflow self-validation**: Added `.github/workflows/**` to path triggers in `ci.yml`. Previously, PRs that modified CI workflow files would not trigger CI to validate those changes — a blind spot that could let broken pipelines merge silently.

### Known Accepted Gaps

- **VSIX packaging not gated in CI**: `npm run package` (vsce) is not part of the CI job. Packaging is a release-time step. Adding it to CI would require the `@vscode/vsce` binary to be available and would add ~30s of build time for every PR — not justified for a gate that only matters at release.
- **No cross-platform extension tests**: Tests run only on `ubuntu-latest`. The extension uses `process.platform === 'win32'` branching in `WispCli.findOnPath()`. A Windows runner would catch platform regressions. Deferred — the branch is simple and well-covered by unit tests with a mocked platform.
- **No VS Code extension host integration test**: The Jest tests mock the `vscode` module. True end-to-end activation in a real VS Code Extension Development Host is not automated. Manual verification is required before each release (see runbook below).

## Automation Changes Applied

### `.github/workflows/ci.yml` — Added `.github/workflows/**` to path triggers

**Why**: Changes to CI workflow files must re-run CI to catch broken YAML, invalid step references, or action version regressions. Without this trigger, a PR editing `ci.yml` bypasses the CI it is changing.

## Release Runbook

### Pre-Deploy Checklist

- [ ] All CI jobs pass on the PR branch (`check` + `vscode-extension`)
- [ ] `npm audit` reports 0 vulnerabilities in `vscode-extension/`
- [ ] Bundle size check: `out/extension.js` < 500 KB (baseline: ~4.6 KB)
- [ ] `npm run package` produces a `.vsix` file without errors
- [ ] Manual smoke-test: Install `.vsix` in VSCode, open a workspace with a `manifests/` folder, verify extension activates and `Wisp AI: Show Version` command appears in the command palette

### Deploy Steps (Extension Release)

1. Bump `version` in `vscode-extension/package.json` following semver
2. Run `cd vscode-extension && npm run package` to produce `wisp-ai-<version>.vsix`
3. For marketplace publishing (future):
   ```bash
   cd vscode-extension
   npx @vscode/vsce publish
   ```
4. For manual distribution: attach `.vsix` to GitHub Release

### Post-Deploy Verification

- Install the published `.vsix` (or marketplace version) in a clean VSCode profile
- Open a workspace containing a `manifests/` folder
- Confirm extension activates (status bar or output channel **Wisp AI** appears)
- Run `Wisp AI: Show Version` from the command palette:
  - If `wisp` is installed: notification shows version string
  - If `wisp` is not installed: notification shows "Wisp binary not found. Install it?" with "Install" button

### Rollback Steps

The extension has no server-side components or database migrations. Rollback is:

1. **Marketplace**: Use `vsce unpublish wisp@<bad-version>` or republish the previous `.vsix`
2. **Manual distribution**: Remove the bad `.vsix` from GitHub Releases; redistribute the previous one
3. **User-side**: Users can downgrade by installing the previous `.vsix` directly (`Extensions: Install from VSIX...`)

There is no stateful rollback concern — the extension reads `wisp.binaryPath` from user settings and calls the CLI. Rolling back the extension does not affect the CLI binary or any workspace state.

## Monitoring & Alerts

### Signals to Watch

| Signal | Where to Check |
|--------|---------------|
| CI job failures | GitHub Actions tab on the PR or `main` branch |
| Bundle size regression | Compare `out/extension.js` size before/after `npm run compile` |
| `npm audit` vulnerability count | Run `npm audit` in `vscode-extension/` before releasing |
| Test failures | `npm test` output; all 9 tests must pass |

### Failure Indicators

- **`npm run compile` fails**: TypeScript type errors or missing imports. Fix before merging.
- **`npm run lint` fails**: ESLint `@typescript-eslint/recommended` violation. Fix before merging.
- **`npm test` fails**: Unit test regression in `WispCli.resolve()` logic. Fix before merging.
- **Bundle size > 500 KB**: A production dependency was accidentally added. Audit `package.json` `dependencies` (should be empty).
- **Extension does not activate**: Check `activationEvents` in `vscode-extension/package.json` against the workspace layout. Verify `main` points to `./out/extension.js`.
