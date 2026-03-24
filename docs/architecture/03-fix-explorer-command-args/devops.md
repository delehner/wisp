# DevOps: VSCode Extension — Fix Explorer Tree Command Arguments

## CI/CD Coverage

### Checks in Place

The existing `ci.yml` workflow provides full coverage for this PR:

| Check | Command | Trigger |
|---|---|---|
| TypeScript compile | `npm run compile` | Push/PR touching `vscode-extension/**` |
| Lint | `npm run lint` | Push/PR touching `vscode-extension/**` |
| Tests | `npm test` | Push/PR touching `vscode-extension/**` |
| Node version | 20 (via `actions/setup-node@v4`) | Always |
| Lock file integrity | `npm ci` | Always |

The new `explorerCommands.test.ts` (25 tests added by the Tester agent) is automatically picked up by `npm test` — no CI changes are required.

The publish workflow (`publish-vscode.yml`) triggers on `vscode-v*` tags, runs the full quality gate (compile + lint + test), validates that the tag version matches `package.json`, then publishes to VS Code Marketplace and Open VSX Registry.

### Gaps Found

None. The path filter `vscode-extension/**` in `ci.yml` ensures the quality gate runs on every PR that touches the extension — including this one.

## Automation Changes Applied

None required. The CI/CD pipeline already covers all quality signals relevant to this bug fix:
- TypeScript type checking catches handler signature regressions
- `npm test` now includes the regression suite from the Tester agent
- Publish workflow enforces version consistency before release

## Release Runbook

### Pre-Deploy Checklist

- [ ] PR is merged to `main`
- [ ] All CI checks pass on `main` (compile, lint, 162+ tests)
- [ ] `package.json` version is bumped to the intended release version (current: `0.1.3`)
- [ ] `VSCE_PAT` secret is set in repository settings (required for VS Code Marketplace publish)

### Deploy Steps

1. **Bump version** in `vscode-extension/package.json` (e.g., `0.1.3` → `0.1.4`)
2. **Commit** the version bump:
   ```bash
   git add vscode-extension/package.json vscode-extension/package-lock.json
   git commit -m "chore(vscode-extension): bump version to 0.1.4"
   git push origin main
   ```
3. **Create and push the release tag**:
   ```bash
   git tag vscode-v0.1.4
   git push origin vscode-v0.1.4
   ```
4. **Monitor** the `Publish VSCode Extension` workflow in GitHub Actions. It will:
   - Run compile + lint + test
   - Validate tag matches `package.json` version
   - Package the `.vsix`
   - Publish to VS Code Marketplace
   - Upload `.vsix` to GitHub Release
   - Attempt to publish to Open VSX Registry (`continue-on-error: true`)

5. **Verify** the published version appears in the VS Code Marketplace within ~5 minutes.

### Post-Deploy Verification

- [ ] VS Code Marketplace listing shows the new version
- [ ] Install the extension from Marketplace into a clean VS Code instance
- [ ] Open a workspace with a `manifests/` directory
- [ ] Expand the Wisp AI Explorer tree and click the inline orchestrate button on a manifest node — confirm the Wisp AI output channel shows the correct CLI invocation (e.g., `wisp orchestrate --manifest /path/to/file.json`)
- [ ] Right-click a subtask node → "Run Pipeline" — confirm output channel shows `wisp pipeline --prd /path/to/prd.md --repo <url>`
- [ ] Open Command Palette → "Wisp AI: Orchestrate" — confirm file picker appears and works (no regression)

### Rollback Steps

If the published version has a critical defect:

1. **Identify** the last known-good version (e.g., `0.1.2`)
2. **Republish** the previous `.vsix` from the GitHub Release assets:
   ```bash
   npx vsce publish --packagePath wisp-ai-0.1.2.vsix --pat "$VSCE_PAT"
   ```
3. **Tag** a corrected version (do not reuse/delete tags):
   ```bash
   git tag vscode-v0.1.5  # next patch after the bad release
   git push origin vscode-v0.1.5
   ```

## Monitoring & Alerts

### Signals to Watch

- **GitHub Actions**: `Publish VSCode Extension` workflow status on tag push
- **VS Code Marketplace**: Publisher dashboard for install/error counts after a new version goes live
- **GitHub Issues**: Watch for new issues labeled `vscode-extension` within 24 hours of release

### Failure Indicators

| Signal | Meaning | Action |
|---|---|---|
| CI `Test` step fails on PR | Handler regression or broken test setup | Fix before merging |
| Publish workflow fails at "Validate version matches tag" | `package.json` version not bumped | Bump version, re-tag with next version |
| Publish workflow fails at "Publish to VS Code Marketplace" | `VSCE_PAT` expired or invalid | Rotate the secret in repo settings |
| Users report `[object Object]` in output panel after update | Handler fix reverted | Rollback to previous `.vsix` immediately |
