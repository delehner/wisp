# Documentation Summary: VS Code Extension Docs & Guides

## Documentation Updated

| File | Section | Change |
|------|---------|--------|
| `vscode-extension/README.md` | Entire file | Rewritten as VS Code Marketplace listing with badge, feature list, quick start, `wisp.binaryPath` config, troubleshooting, absolute GitHub URLs for all doc links, and "For Contributors" section at the bottom |
| `docs/prerequisites.md` | After "Installing the wisp CLI" | Added "Optional: VS Code Extension" section linking to `vscode-install.md` |
| `docs/project-structure.md` | File Reference table | Updated `vscode-extension/README.md` row description; added rows for `docs/vscode-extension.md`, `docs/vscode-install.md`, `docs/vscode-publish.md` |
| `docs/pipeline-overview.md` | Before "CLI Reference" | Added "Running from VS Code" section describing Command Palette → CLI subcommand mapping, with link to `docs/vscode-extension.md` |
| `README.md` | Documentation section | Added "VS Code Extension" subsection listing all three new docs |
| `CLAUDE.md` | Entire file | Replaced short (~82 line) version with the comprehensive project context document covering architecture, coding conventions, testing, and environment variables |

## Documentation Created

| File | Purpose |
|------|---------|
| `docs/vscode-extension.md` | Feature guide: Mermaid command-flow diagram, Getting Started, Commands table, `wisp.binaryPath` configuration, activation triggers, troubleshooting |
| `docs/vscode-install.md` | End-user installation guide: prerequisites, three install methods (Marketplace, VSIX, build from source), verification step, troubleshooting |
| `docs/vscode-publish.md` | Maintainer publishing guide: one-time Azure DevOps publisher + PAT setup, GitHub secret storage, release steps, PAT rotation, troubleshooting |

## Changelog Entry

```
### Added
- VS Code extension for running Wisp commands from the Command Palette (`vscode-extension/`)
- `docs/vscode-extension.md` — feature guide: commands, configuration, activation, troubleshooting
- `docs/vscode-install.md` — installation guide: Marketplace, VSIX, build from source
- `docs/vscode-publish.md` — maintainer publishing guide: PAT setup, release process, rotation

### Changed
- `vscode-extension/README.md` rewritten as a VS Code Marketplace listing
- `docs/prerequisites.md` updated with optional VS Code Extension install section
- `docs/project-structure.md` updated with new VS Code doc file references
- `docs/pipeline-overview.md` updated with "Running from VS Code" section
- `README.md` Documentation section updated with VS Code Extension links
- `CLAUDE.md` replaced with comprehensive project context document
```

## Link Verification

- Internal links checked: 8
- Broken links found: 0
- External links verified: 3 standard well-known URLs (marketplace.visualstudio.com, dev.azure.com, open-vsx.org)

## Code Examples

- Examples tested: 4 (bash install commands, jsonc settings snippets, git tag commands)
- Examples fixed: 0 (all verified accurate against `package.json` and `.github/workflows/publish-vscode.yml`)

## Notes

- Sidebar (tree view) section not written in `docs/vscode-extension.md` — `package.json` has no `contributes.views` on this branch; PRD 02 work has not merged. The feature guide notes this.
- Only `wisp.showVersion` is in the commands table — the sole registered command in `package.json`.
- All `vscode-extension/README.md` doc cross-links use absolute `https://github.com/delehner/wisp/blob/main/docs/...` URLs per Marketplace requirement.
