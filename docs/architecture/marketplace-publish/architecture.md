# Architecture: VSCode Extension Marketplace Publishing

## Overview

Add `.github/workflows/publish-vscode.yml` — a GitHub Actions workflow that publishes the Wisp VSCode extension to the VS Code Marketplace and Open VSX Registry when a `vscode-v*` tag is pushed, and attaches the `.vsix` artifact to a GitHub Release. This decouples extension releases from CLI releases (`v*` tags → `release.yml`).

## System Design

### Components

- **Publish workflow** (`.github/workflows/publish-vscode.yml`): Single job — `publish` — that runs CI gate, version validation, packaging, marketplace publish, GitHub Release creation, and optional Open VSX publish.
- **VSCE** (`@vscode/vsce ^2.24.0`): Already in `vscode-extension/devDependencies`. Invoked via `npx vsce`. Produces `wisp-<version>.vsix`.
- **softprops/action-gh-release@v2**: Creates GitHub Release and attaches VSIX. Same action used in `release.yml`.
- **OVSX** (`ovsx`): Optional publish to Open VSX. Invoked via `npx ovsx`. Step runs only when `OVSX_PAT` secret is present.

### Data Flow

```
push tag vscode-v*
  → checkout + Node 20 setup + npm ci
  → compile + lint + test (CI gate)
  → version validation (tag vs package.json)
  → npx vsce package → wisp-<version>.vsix
  → npx vsce publish --pat $VSCE_PAT
  → softprops/action-gh-release@v2 (attach .vsix, set title + pre-release flag)
  → npx ovsx publish (if OVSX_PAT set, continue-on-error)
```

### Data Models

No new data models. The workflow reads:
- `GITHUB_REF_NAME` — the pushed tag (e.g., `vscode-v0.2.0`)
- `vscode-extension/package.json` — `.version` field (e.g., `0.2.0`)

Output artifact: `wisp-<version>.vsix` produced by `vsce package` in `vscode-extension/`.

### API Contracts

No new APIs. External service integrations:

| Service | Auth | Action |
|---------|------|--------|
| VS Code Marketplace | `VSCE_PAT` secret (Azure DevOps PAT) | `npx vsce publish --pat` |
| Open VSX Registry | `OVSX_PAT` secret | `npx ovsx publish` |
| GitHub Releases | `GITHUB_TOKEN` (automatic) | `softprops/action-gh-release@v2` |

## File Structure

```
.github/
└── workflows/
    └── publish-vscode.yml   # New: VSCode extension publish workflow
docs/
└── architecture/
    └── marketplace-publish/
        └── architecture.md  # This document
```

No source code changes. No `vscode-extension/` file changes.

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Release action | `softprops/action-gh-release@v2` | Already used in `release.yml`; supports pre-release flag, file globs | `gh release create` — requires manual pre-release detection and separate upload step |
| vsce invocation | `npx vsce` | `@vscode/vsce` is already in devDependencies; no global install step needed | `npm run package` (calls `vsce package` but not `vsce publish`) |
| working-directory | `defaults.run.working-directory: vscode-extension` | Matches `ci.yml` pattern; avoids repeating `working-directory:` on every step | Per-step `working-directory` — verbose |
| Version extraction | `node -p "require('./package.json').version"` | Same technique used in PRD sketch; works without `jq` | `jq -r .version package.json` — requires jq |
| Pre-release detection | `[[ "$TAG_VERSION" == *-* ]]` bash glob | Simple, no regex; any hyphen suffix (beta, rc, alpha) is pre-release | Regex match on tag name |
| Open VSX | `continue-on-error: true` + `if: secrets.OVSX_PAT != ''` | PRD specifies optional, non-blocking | Separate job — overkill for one step |
| npm cache | `cache: "npm"` + `cache-dependency-path: vscode-extension/package-lock.json` | Matches `ci.yml`; speeds up installs | No cache |

## Dependencies

No new packages. Runtime workflow dependencies (all pinned to existing versions in use):
- `actions/checkout@v4`
- `actions/setup-node@v4`
- `softprops/action-gh-release@v2`
- `@vscode/vsce ^2.24.0` (already in devDependencies)
- `ovsx` (invoked via `npx ovsx` — downloaded at runtime only when OVSX_PAT is set)

Required secrets (configured in GitHub repo settings):
- `VSCE_PAT` — Azure DevOps Personal Access Token with Marketplace publish scope
- `OVSX_PAT` — Open VSX Registry token (optional)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `VSCE_PAT` expires silently | High — future publishes fail with auth error | Document PAT expiry (1 year) and annual rotation in repo docs (PRD 04 scope) |
| Publisher not verified on Marketplace | High — `vsce publish` fails | Publisher `delehner` must be verified at marketplace.visualstudio.com before first publish |
| `vsce package` glob `wisp-*.vsix` picks up wrong file if multiple VSIXs present | Low | `vsce package` always outputs exactly one file named `{name}-{version}.vsix`; glob is safe |
| `npm test` flakiness blocks release | Medium | Tests run in CI on every PR already; if flaky, fix test before tagging |
| Tag/package.json version mismatch | Medium | FR-4 validation step fails fast with clear message before any publish step runs |

## Implementation Tasks

For the **DevOps/Developer** agent — ordered:

1. **Create `.github/workflows/publish-vscode.yml`**
   - Trigger: `push: tags: ['vscode-v*']`
   - `permissions: contents: write` at workflow level
   - Job `publish` on `ubuntu-latest`
   - `defaults.run.working-directory: vscode-extension`
   - Acceptance: file exists, YAML is valid, trigger pattern is correct

2. **Add checkout + Node setup steps**
   - `actions/checkout@v4`
   - `actions/setup-node@v4` with `node-version: '20'`, `cache: 'npm'`, `cache-dependency-path: vscode-extension/package-lock.json`
   - `npm ci`
   - Acceptance: matches `ci.yml` vscode-extension job pattern

3. **Add CI gate steps**
   - `npm run compile`
   - `npm run lint`
   - `npm test`
   - No `continue-on-error` — failures must block publish
   - Acceptance: same scripts as `ci.yml` vscode-extension job

4. **Add version validation step**
   - Shell: `bash`
   - Strip `vscode-v` prefix from `GITHUB_REF_NAME`
   - Compare to `node -p "require('./package.json').version"`
   - `exit 1` with message if mismatch
   - Store `PKG_VERSION` as env var for reuse in release title
   - Acceptance: validation fails with clear message on mismatch; passes on match

5. **Add package + publish steps**
   - `npx vsce package` — produces `wisp-<version>.vsix`
   - `npx vsce publish --pat ${{ secrets.VSCE_PAT }}`
   - No `continue-on-error` on publish
   - Acceptance: secrets referenced via `${{ secrets.VSCE_PAT }}`, not env

6. **Add GitHub Release step**
   - `softprops/action-gh-release@v2`
   - `files: vscode-extension/wisp-*.vsix` (path relative to repo root since this step runs at repo root)
   - `name: "VSCode Extension v${{ env.PKG_VERSION }}"` (use env var set in validation step)
   - `prerelease: ${{ contains(github.ref_name, '-') }}` — auto-detect pre-release from tag suffix
   - `generate_release_notes: false` (extension releases don't need Rust changelog)
   - Acceptance: VSIX attached to release; pre-release flag set correctly for `-beta`/`-rc` tags

7. **Add Open VSX step (optional)**
   - `if: secrets.OVSX_PAT != ''`
   - `continue-on-error: true`
   - `npx ovsx publish wisp-*.vsix --pat ${{ secrets.OVSX_PAT }}`
   - Acceptance: step skipped when secret absent; failure doesn't fail job

## Security Considerations

- `VSCE_PAT` and `OVSX_PAT` must only appear in `--pat` flags — never in `echo`, `env:` blocks at job level, or logged output
- `permissions: contents: write` is the minimum required for `softprops/action-gh-release@v2` to create releases and upload assets; all other permissions default to `read`
- No `secrets: inherit` — secrets are passed explicitly per step
- `actions/checkout@v4` uses the default `GITHUB_TOKEN` (read-only for checkout); the elevated `contents: write` permission is only exercised by the release step

## Performance Considerations

- `npm ci` with `cache: 'npm'` avoids re-downloading node_modules on repeated runs
- Single job (no matrix) — extension publish is inherently sequential (validate → package → publish → release)
- Total expected runtime: ~2–3 minutes (dominated by `npm ci` and `npm test`)
