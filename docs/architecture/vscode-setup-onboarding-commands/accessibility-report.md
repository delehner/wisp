# Accessibility Report: VSCode Extension — Setup & Onboarding Commands

## Compliance Target

- WCAG 2.1 Level AA (adapted for VS Code extension context)
- VS Code Accessibility API best practices

> Note: This is a VS Code extension, not a web application. Traditional WCAG HTML/CSS criteria (landmark regions, heading hierarchy, color contrast of rendered HTML) do not apply. Compliance is assessed against VS Code's accessibility model: keyboard navigation, screen reader announcements via `TreeItem.accessibilityInformation`, `InputBox`/`QuickPick` prompt/placeHolder fields, and notification text.

## Audit Summary

| Category | Issues Found | Fixed | Remaining |
|----------|-------------|-------|-----------|
| Perceivable | 1 | 1 | 0 |
| Operable | 0 | 0 | 0 |
| Understandable | 0 | 0 | 0 |
| Robust | 0 | 0 | 0 |

## Findings

### Critical

None.

### Major

None.

### Minor

| Issue | Location | Fix Applied |
|-------|----------|-------------|
| Setup step status (complete/pending) conveyed via icon and tooltip only — screen readers do not read tooltips without hover | `src/treeView/setupSection.ts` — `SetupTreeItem` constructor | Added `accessibilityInformation: { label: \`${label}: complete\` }` and `{ label: \`${label}: pending\` }` for step items where `isComplete` is defined |

## Keyboard Navigation

- **Tab order**: All VS Code extension UI is natively keyboard-navigable. The Explorer tree, QuickPick, and InputBox widgets handle focus management via the VS Code platform.
- **Focus management for QuickPick/InputBox**: VS Code automatically traps focus within modal widgets; Escape exits cleanly at every step.
- **Keyboard shortcuts**: No custom keybindings added by this feature; all actions reachable via Command Palette and Explorer tree click.
- **Tree navigation**: Explorer tree supports arrow keys, Enter to activate, all provided natively by VS Code.

## Input Wizard Accessibility

All `showInputBox` calls include both `title`, `prompt`, and `placeHolder` fields (required NFR satisfied):

| Step | Title | Prompt | PlaceHolder | Password |
|------|-------|--------|-------------|----------|
| Provider (QuickPick) | Wisp AI Setup: Provider | — | Select AI provider | — |
| Claude OAuth token | Wisp AI Setup: Claude Auth (1/2) | Claude OAuth token… | Leave blank if using Anthropic API key instead | ✓ |
| Anthropic API key | Wisp AI Setup: Claude Auth (2/2) | Anthropic API key… | sk-ant-... | ✓ |
| Gemini API key | Wisp AI Setup: Gemini Auth (1/2) | Gemini API key | AIza... | ✓ |
| Google API key | Wisp AI Setup: Gemini Auth (2/2) | Google API key (alternative) | AIza... | ✓ |
| GitHub token | Wisp AI Setup: GitHub Token (optional) | GitHub token… | ghp_... (leave blank to skip) | ✓ |
| Advanced settings (QuickPick) | Wisp AI Setup: Advanced Settings (optional) | — | Select settings to configure (Escape to skip) | — |
| Each advanced setting | Wisp AI Setup: {label} | {label} | Default: {value} | — |

Auth inputs use `password: true` — keys are masked and not exposed in screen reader output or output channels.

## Screen Reader Testing

- **Dynamic content announcements**: VS Code handles announcements for QuickPick selection changes and InputBox focus natively.
- **Setup step status**: Fixed — `accessibilityInformation` now explicitly announces "(complete)" or "(pending)" status so screen readers do not rely on icon interpretation or tooltip hover.
- **Wizard validation messages**: Auth validation errors use `vscode.window.showErrorMessage` — VS Code announces these as alerts.
- **Notifications**: All success/error/warning messages use standard VS Code notification APIs, which are accessible.

## Recommendations

- No outstanding issues requiring design or architecture changes.
- If future steps are added to the Setup section, ensure `accessibilityInformation` is set on any items where status or type is conveyed only through icons.
