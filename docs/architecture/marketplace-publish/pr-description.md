## Summary

- Adds `.github/workflows/publish-vscode.yml` — a GitHub Actions workflow that automatically publishes the Wisp VS Code extension to the VS Code Marketplace when a `vscode-v*` tag is pushed
- Mirrors the existing `release.yml` pattern for the Rust binary, giving maintainers an independent release path for the extension
- Adds release runbook, test report, and updated documentation for the new publish process

## Changes

- `.github/workflows/publish-vscode.yml` (new): publish workflow triggered on `vscode-v*` tags — runs compile/lint/test gate, validates tag version matches `package.json`, packages the VSIX, publishes to VS Code Marketplace, creates GitHub Release with VSIX artifact, and optionally publishes to Open VSX Registry
- `vscode-extension/README.md`: added "Publish to Marketplace" section documenting the tag convention, required secrets, and pre-release behavior
- `README.md`: updated `.github/workflows/` description in Project Structure to include the new workflow
- `docs/architecture/marketplace-publish/`: architecture spec, devops runbook (pre-deploy checklist, deploy steps, rollback, PAT rotation), test report (static review + 5-case manual test plan), and documentation summary

## Architecture Decisions

- **Tag scheme `vscode-v*`** separates extension releases from CLI releases (`v*` tags) so each can ship independently
- **`permissions: contents: write` at workflow level** (not job level) — required for `softprops/action-gh-release@v2` to upload VSIX assets; matches `release.yml` convention
- **`defaults.run.working-directory: vscode-extension`** avoids repeating `working-directory:` on every `run:` step
- **`npx vsce` / `npx ovsx`** — no global install; `@vscode/vsce ^2.24.0` is already in `devDependencies`
- **Version validation** (`${GITHUB_REF_NAME#vscode-v}` vs `package.json` version) prevents accidentally publishing a stale version — fails fast with a clear error message
- **Pre-release detection** uses `contains(github.ref_name, '-')` as a native GHA expression in the `softprops/action-gh-release@v2` `prerelease` input
- **Open VSX** is optional and `continue-on-error: true` — a registry outage does not block the Marketplace publish
- **`generate_release_notes: false`** — extension releases use their own release notes; Rust commit history is not relevant

## Testing

- Unit/integration tests: none added (GitHub Actions workflows have no unit-testable logic)
- Static review: all FR-1 through FR-4 acceptance criteria verified line-by-line against the workflow YAML — 100% pass
- Manual test plan: 5 test cases documented in `docs/architecture/marketplace-publish/test-report.md`
  - TC-1: Happy path (`vscode-v0.2.0`, versions match, all secrets set)
  - TC-2: Pre-release tag (`vscode-v0.2.0-beta` → `prerelease: true`)
  - TC-3: Version mismatch → workflow fails at validation step with clear error
  - TC-4: `OVSX_PAT` not set → Open VSX step skipped; rest of workflow succeeds
  - TC-5: `npm test` fails → publish blocked; no broken release reaches users

## Screenshots / Recordings

No UI changes. To verify manually: push a `vscode-vX.Y.Z-test` tag to a fork with `VSCE_PAT` configured and confirm each step passes in the Actions tab.

## Checklist

- [x] Tests pass (`cargo test` for Rust; no new npm tests added — workflow-only change)
- [x] Build succeeds (`cargo build --release` unaffected; no Rust changes)
- [x] No linter errors (`cargo clippy -- -D warnings` unaffected; YAML has no linter configured)
- [x] Architecture doc reviewed (`docs/architecture/marketplace-publish/architecture.md`)
- [x] Design spec followed (N/A — no UI)
- [x] Accessibility verified (N/A — no UI)
- [x] Security considerations addressed (`VSCE_PAT`/`OVSX_PAT` secrets only used in publish steps, not echoed; `permissions: contents: write` scoped to workflow level)

## Review Notes

Before merging, the maintainer must ensure:
1. `VSCE_PAT` secret is configured in GitHub repo Settings → Secrets and variables → Actions (Azure DevOps PAT with **Marketplace (Publish)** scope)
2. Publisher `delehner` is verified at marketplace.visualstudio.com/manage — the workflow will fail at `vsce publish` if the publisher account is not verified
3. Set `VSCE_PAT` expiry to 1 year and add a calendar reminder to rotate it annually (see `docs/architecture/marketplace-publish/devops.md` for rotation steps)

`OVSX_PAT` is optional — if the secret is absent the Open VSX step is skipped automatically.
