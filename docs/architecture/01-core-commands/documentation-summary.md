# Documentation Summary: VSCode Extension Core Commands

## Documentation Updated

| File | Section | Change |
|------|---------|--------|
| `vscode-extension/README.md` | Top-level intro | Added feature overview paragraph |
| `vscode-extension/README.md` | Features | New section listing streaming output, status bar, file pickers, process management |
| `vscode-extension/README.md` | Commands | New table of all 11 commands with palette titles and descriptions |
| `vscode-extension/README.md` | Configuration | New table documenting `wisp.binaryPath` setting (scope, default, description) |

## Documentation Created

| File | Purpose |
|------|---------|
| `vscode-extension/CHANGELOG.md` | Extension changelog — initial v0.1.0 entry covering all new commands and features |

## Changelog Entry

### Added
- Full command palette surface (11 commands) covering all wisp CLI subcommands
- Streaming output to dedicated Output Channel
- Status bar indicator (Running/Idle) with click-to-reveal
- File pickers for manifests and PRDs with workspace search and manual fallback
- Process cancellation via "Wisp: Stop Pipeline"
- Concurrent pipeline guard (warning if pipeline already active)

## Link Verification

- Internal links checked: 1 (GitHub repo URL in README intro)
- Broken links found: 0
- External links verified: 0 (GitHub URL not fetched; correct per project repo)

## Code Examples

- Examples tested: 0 (no code examples added; commands are UI-driven, not scripted)
- Examples fixed: 0
