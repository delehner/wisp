# Dependency Report: VSCode Extension Tests — wisp.explorer.generatePrd (v0.1.4)

## New Dependencies

None. The Developer agent confirmed no new packages were added to `package.json`. The changes are limited to:
- `vscode-extension/src/extension.ts` — 2-line handler signature change (`item?: ManifestItem`, `item?.fsPath`)
- `vscode-extension/src/__tests__/explorerCommands.test.ts` — 4 new Jest test cases

All existing test infrastructure (Jest ^29.7.0, ts-jest ^29.1.0) was already in `devDependencies`.

## Vulnerability Scan

Tool: `npm audit` (npm v10, lockfileVersion 3)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Moderate | 0 |
| Low      | 0 |
| Info     | 0 |
| **Total**| **0** |

Result: **0 vulnerabilities found.**

## License Audit

No new dependencies introduced. No new license review required.

Existing direct devDependencies and their licenses (all permissive):

| Package | Version | License |
|---------|---------|---------|
| @types/jest | ^29.5.0 | MIT |
| @types/node | ^20.0.0 | MIT |
| @types/vscode | ^1.85.0 | MIT |
| @typescript-eslint/eslint-plugin | ^7.0.0 | MIT |
| @typescript-eslint/parser | ^7.0.0 | MIT |
| @vscode/vsce | ^2.24.0 | MIT |
| esbuild | ^0.25.0 | MIT |
| eslint | ^8.57.0 | MIT |
| jest | ^29.7.0 | MIT |
| ts-jest | ^29.1.0 | MIT |
| typescript | ^5.3.0 | Apache-2.0 |

All licenses are permissive (MIT / Apache-2.0). No copyleft or non-commercial licenses present. ✅

## Maintenance Health

No new dependencies to evaluate. All existing devDependencies are actively maintained:
- `jest` 29.x: maintained by Meta/Jest team, weekly downloads >40M ✅
- `ts-jest` 29.x: actively maintained, compatible with Jest 29 ✅
- `typescript` 5.x: maintained by Microsoft ✅

## Lock File Status

- Lock file present: ✅ (`package-lock.json`, lockfileVersion 3)
- Lock file consistent with `package.json`: ✅ (no drift detected)
- No phantom dependencies: ✅

## Transitive Dependency Summary

- New transitive dependencies added: **0**
- Total installed (prod + dev + optional): 703 packages (unchanged from before this PRD)
- No new duplicate packages at different versions introduced

## Recommendations

No action required. The dependency posture is unchanged by this PRD. Continue monitoring:
- `jest` / `ts-jest` for compatibility when upgrading to Jest 30 (not yet released)
- `@vscode/vsce` for VSCode marketplace publishing requirements changes
