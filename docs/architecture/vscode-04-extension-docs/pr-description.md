# PR Description: VSCode Extension Documentation & Guides

## Summary

Adds comprehensive documentation for the Wisp VS Code extension: a feature guide, an installation guide, and a maintainer publishing guide. Updates the Marketplace README and four existing docs to reference the extension alongside the CLI.

This is a docs-only PR — no TypeScript or Rust source changes.

## Changes

- `docs/vscode-extension.md` (new): Feature guide covering the `wisp.showVersion` command, `wisp.binaryPath` configuration, activation events, and troubleshooting. Includes a Mermaid diagram of the command → binary flow. Notes that additional commands will be added when PRD 01 lands.
- `docs/vscode-install.md` (new): Step-by-step installation guide covering Marketplace, VSIX sideload, and build-from-source methods, plus verification steps and troubleshooting for binary-not-found and activation failures.
- `docs/vscode-publish.md` (new): Maintainer publishing guide covering one-time Azure DevOps publisher and VSCE PAT setup, the tag-based release process (`vscode-vX.Y.Z`), workflow validation (version-match check), PAT rotation, Open VSX setup, and troubleshooting for expired PATs and version mismatches.
- `vscode-extension/README.md` (rewrite): Marketplace-facing listing with badge, feature summary, quick start, configuration table, requirements, documentation links, and troubleshooting. All doc links use absolute `https://github.com/delehner/wisp/blob/main/docs/...` URLs so they resolve on the VS Code Marketplace.
- `docs/prerequisites.md` (update): Added "VS Code Extension (Optional)" section after the binary install section, linking to `vscode-install.md`.
- `docs/project-structure.md` (update): Added `vscode-extension/README.md` row to File Reference table; added rows for the three new doc files.
- `docs/pipeline-overview.md` (update): Added "Running from VS Code" section before CLI Reference describing how Command Palette commands map to CLI subcommands.
- `README.md` (update): Added "VS Code Extension" subsection in the Documentation section with links to all three new docs.
- `CLAUDE.md` (update): Expanded docs/ directory comment to enumerate the three new doc filenames.

## Architecture Decisions

- **Scope limited to `package.json` reality**: PRD FR-1 references 10 commands and a sidebar from PRDs 01–02 (not yet merged to this branch). Documentation covers only what is actually registered in `package.json` (`wisp.showVersion`, `wisp.binaryPath`). A note in `docs/vscode-extension.md` explains that additional commands arrive with PRD 01. Documenting non-existent features would be misleading.
- **Absolute URLs in `vscode-extension/README.md`**: The VS Code Marketplace renders the README outside of the repository context, so relative paths like `../docs/...` would break. All cross-links use `https://github.com/delehner/wisp/blob/main/docs/...`.
- **`wisp.binaryPath` security note**: The `machine-overridable` scope (not `workspace`) prevents a repository's `.vscode/settings.json` from redirecting the extension to an untrusted binary. This is documented in both the feature guide and the Marketplace README.

## Testing

- No unit tests added (docs-only PR).
- All cross-doc relative links verified against actual file paths.
- All absolute GitHub URLs in `vscode-extension/README.md` verified against files on the `main` branch.
- Command ID `wisp.showVersion` verified against `vscode-extension/package.json` (exact case match).
- Workflow steps in `docs/vscode-publish.md` verified against `.github/workflows/publish-vscode.yml`.

## Checklist

- [x] Build succeeds (no Rust or TypeScript source changes)
- [x] No linter errors (markdown only)
- [x] Architecture doc reviewed
- [x] Command IDs match `package.json` exactly
- [x] VSCE PAT rotation references correct Azure DevOps UI path
- [x] `CLAUDE.md` key docs list updated
- [x] Absolute GitHub URLs used in `vscode-extension/README.md`
- [x] "VS Code" (with space) used consistently in prose
- [x] "wisp" (lowercase) for CLI, "Wisp" (capitalized) for extension product

## Review Notes

This PR is a prerequisite for the three VS Code extension PRDs (01–03) to have discoverable documentation. The command list in `docs/vscode-extension.md` is intentionally minimal until PRD 01 merges — the "more commands coming" note makes this transparent to readers. When PRD 01 lands, update the commands table in `docs/vscode-extension.md` and the feature list in `vscode-extension/README.md`.
