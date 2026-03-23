## Summary

- Adds `.github/workflows/publish-vscode.yml` — automated VS Code Marketplace publish pipeline triggered on `vscode-v*` tags, independent of the Rust CLI release workflow
- Uploads `.vsix` to GitHub Releases on each tag; optionally publishes to Open VSX Registry if `OVSX_PAT` secret is present
- Documents the release process in `vscode-extension/README.md` with step-by-step instructions and a pre-release tags note

## Changes

- `.github/workflows/publish-vscode.yml` *(new)*: Triggered on `vscode-v*` tag push. Runs `npm ci` → `compile` → `lint` → `test` → version validation → `vsce package` → `vsce publish` → GitHub Release upload (with VSIX attachment and pre-release flag) → Open VSX publish (optional, `continue-on-error: true`). Uses `softprops/action-gh-release@v2` consistent with `release.yml`.
- `vscode-extension/README.md` *(updated)*: Added "Publishing to the VS Code Marketplace" section covering prerequisites, release steps, pre-release tag behaviour, and sideloading.
- `docs/architecture/vscode-03-marketplace-publish/architecture.md` *(new)*: Full architecture document — system design, data flow, technical decisions, security constraints, implementation tasks.
- `docs/architecture/vscode-03-marketplace-publish/devops.md` *(new)*: CI/CD coverage analysis, automation changes, release runbook, monitoring signals.
- `docs/architecture/vscode-03-marketplace-publish/test-report.md` *(new)*: Static FR verification (14/14 passing), 6 manual test scenarios, 0 bugs found, 3 recommendations.
- `docs/architecture/vscode-03-marketplace-publish/documentation-summary.md` *(new)*: Summary of all documentation changes produced by this pipeline.

## Architecture Decisions

- **`vscode-v*` tag namespace** — separates extension releases from `v*` CLI releases so each can ship independently.
- **`npx @vscode/vsce`** — uses the `@vscode/vsce ^2.24.0` already in `devDependencies`; no extra global install step.
- **`defaults.run.working-directory: vscode-extension`** at job level — avoids per-step repetition, mirrors the `vscode-extension` job in `ci.yml`.
- **`softprops/action-gh-release@v2`** — consistent with `release.yml`; handles VSIX attachment and `prerelease` flag from the `is_prerelease` output.
- **Pre-release detection** — presence of `-` in the version string (e.g. `1.0.0-beta`) sets the GitHub Release pre-release flag. Marketplace pre-release publish (`vsce publish --pre-release`) requires a manual step, documented in the README.
- **Open VSX optional** — `if: ${{ secrets.OVSX_PAT != '' }}` with `continue-on-error: true`; failure does not block Marketplace publish.
- **`permissions: contents: write`** at workflow level — required for `softprops/action-gh-release@v2` to upload release assets.

## Testing

- No automated tests for GitHub Actions workflows (no viable harness).
- Static analysis verified all 14 FR acceptance criteria against the workflow YAML.
- Manual test plan: 6 scenarios (happy path, version mismatch fail, pre-release detection, stable detection, Open VSX skip, Open VSX failure non-blocking) — to be executed against a fork before first production `vscode-v*` tag.

## Checklist

- [x] Build succeeds (`vsce package` validated locally via `npm run package`)
- [x] Tests pass (`npm test` uses Jest with mocked vscode; no display server required)
- [x] No linter errors (`npm run lint` passes)
- [x] Architecture doc reviewed
- [x] Design spec followed (all 14 FR acceptance criteria satisfied)
- [x] Security considerations addressed (secrets scoped to publish steps only; `VSCE_PAT` not logged)

## Review Notes

- **`VSCE_PAT` setup required before first publish**: maintainer must create an Azure DevOps PAT with Marketplace → Manage scope and add it as a repository secret. The PAT should be set to expire in 1 year with a rotation reminder.
- **`ovsx` is not in devDependencies**: the Open VSX step runs `npx ovsx` which downloads the package on first use. This is acceptable for an optional, non-blocking step.
- **Marketplace pre-release flag**: the `--pre-release` flag for `vsce publish` is not automatically added for `-` tags. The workflow marks the GitHub Release as pre-release but the Marketplace publish always runs as a stable publish. If Marketplace pre-release support is needed in future, add a step output and conditional `--pre-release` flag to the publish step.
