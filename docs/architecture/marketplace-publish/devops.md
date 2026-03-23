# DevOps: VSCode Extension Marketplace Publishing

## CI/CD Coverage

### Checks in Place

| Check | Where | Notes |
|-------|-------|-------|
| `npm ci` | `publish-vscode.yml` + `ci.yml` | Dependency install, fails on lockfile mismatch |
| `npm run compile` | `publish-vscode.yml` + `ci.yml` | TypeScript compilation gate |
| `npm run lint` | `publish-vscode.yml` + `ci.yml` | ESLint; fails on violations |
| `npm test` | `publish-vscode.yml` + `ci.yml` | Jest unit tests; publish blocked if any fail |
| Version validation | `publish-vscode.yml` | Tag vs `package.json` version; fails fast with clear message |
| VSCE package | `publish-vscode.yml` | Confirms extension is packageable before publish |

### Gaps Found

- **No workflow-level YAML linting** — GitHub validates on push, but no pre-push local check (low priority; YAML is simple)
- **No PAT expiry reminder** — `VSCE_PAT` is an Azure DevOps PAT that expires; no automated alert when it nears expiry (document in rotation notes below)
- **No dry-run publish step** — `vsce publish --dry-run` is not run before the real publish; the packaging step serves as a partial gate

## Automation Changes Applied

### `.github/workflows/publish-vscode.yml` (new file)

Created a dedicated publish workflow triggered on `vscode-v*` tags. Changes from the PRD sketch:

- Added `cache: "npm"` + `cache-dependency-path` on the Node setup step — matches `ci.yml` pattern, avoids redundant `node_modules` downloads on re-runs
- Version extracted to `$GITHUB_ENV` as `PKG_VERSION` in the validation step so it can be referenced by name in the release title (`VSCode Extension v${{ env.PKG_VERSION }}`)
- Pre-release detection uses `contains(github.ref_name, '-')` as a GitHub Actions expression (equivalent to `[[ "$TAG_VERSION" == *-* ]]` but evaluates natively in the `softprops/action-gh-release@v2` `prerelease` input)
- `generate_release_notes: false` — extension releases don't include Rust changelog; maintainer writes release notes manually or via tag annotation
- Open VSX step uses `npx ovsx` (no global install); `continue-on-error: true` so a registry outage does not block the Marketplace publish

## Release Runbook

### Pre-Deploy Checklist

- [ ] `vscode-extension/package.json` `.version` is set to the intended release version (e.g., `0.2.0`)
- [ ] All changes are merged to `main`
- [ ] `VSCE_PAT` secret is valid and not expired (check in GitHub repo Settings → Secrets)
- [ ] Publisher `delehner` is verified at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/manage)
- [ ] CI is green on `main` for the `vscode-extension` job

### Deploy Steps

```bash
# 1. Confirm package.json version matches intended release
cat vscode-extension/package.json | grep '"version"'

# 2. Create and push the tag
git tag vscode-v0.2.0
git push origin vscode-v0.2.0
```

The `publish-vscode.yml` workflow triggers automatically and:
1. Runs compile + lint + test (CI gate)
2. Validates tag version matches `package.json`
3. Packages the extension (`wisp-0.2.0.vsix`)
4. Publishes to VS Code Marketplace
5. Creates GitHub Release with VSIX attached
6. Publishes to Open VSX (if `OVSX_PAT` is configured)

### Post-Deploy Verification

- [ ] GitHub Actions run completes green: `https://github.com/delehner/wisp/actions/workflows/publish-vscode.yml`
- [ ] Extension appears on Marketplace: search "Wisp" at [marketplace.visualstudio.com](https://marketplace.visualstudio.com)
- [ ] GitHub Release created with `wisp-<version>.vsix` attached: `https://github.com/delehner/wisp/releases`
- [ ] Version shown in VS Code Extensions panel matches the published version

### Rollback Steps

VS Code Marketplace does not support unpublishing a specific version — only the entire extension can be unpublished. For a bad release:

1. **Fix forward**: bump `package.json` to a patch version (e.g., `0.2.1`), fix the issue, tag `vscode-v0.2.1`
2. **Emergency unpublish** (last resort): `npx vsce unpublish delehner.wisp` — removes the extension entirely from the Marketplace; use only if the release causes security or data-loss issues
3. **GitHub Release**: delete or mark the GitHub Release as pre-release via the Releases UI; the VSIX remains downloadable but is de-emphasized

## Monitoring & Alerts

### Signals to Watch

| Signal | Where to Check | Frequency |
|--------|---------------|-----------|
| Workflow run status | GitHub Actions → `publish-vscode.yml` | On every tag push |
| Marketplace install count + rating | marketplace.visualstudio.com/manage | Weekly |
| Open VSX publish step result | Workflow run logs (step: "Publish to Open VSX Registry") | On every tag push |

### Failure Indicators

| Failure | Cause | Action |
|---------|-------|--------|
| `vsce publish` exits non-zero with auth error | `VSCE_PAT` expired or revoked | Rotate PAT in Azure DevOps → update GitHub secret `VSCE_PAT` |
| Version validation fails | `package.json` version not updated before tag | Update version, delete tag, re-tag |
| `npm test` fails | Test regression introduced before tag | Fix tests, delete tag, re-tag |
| Open VSX step fails (non-blocking) | Registry outage or invalid `OVSX_PAT` | Check Open VSX status; rotate `OVSX_PAT` if auth error |
| GitHub Release step fails | `GITHUB_TOKEN` permissions issue | Confirm `permissions: contents: write` is set at workflow level |

### PAT Rotation Reminder

`VSCE_PAT` is an Azure DevOps Personal Access Token. Set expiry to **1 year** when creating. Add a calendar reminder to rotate it annually:

1. Go to [dev.azure.com](https://dev.azure.com) → User Settings → Personal Access Tokens
2. Create new token with **Marketplace (Publish)** scope
3. Update secret in GitHub: repo Settings → Secrets and variables → Actions → `VSCE_PAT`
