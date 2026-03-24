# Architecture: Fix Explorer Tree Command Arguments

## Overview

Tree view inline action buttons and context-menu commands in the Wisp AI VSCode extension were passing tree item objects to command handlers that expected plain string arguments. This caused every Explorer-triggered command to fail with `Error: failed to read manifest: [object Object]` because Node.js serializes unknown objects to `"[object Object]"` when constructing CLI subprocess args.

This is a targeted, single-file fix in `vscode-extension/src/extension.ts`.

## System Design

### Root Cause

When a VSCode menu contribution in `view/item/inline` or `view/item/context` does not include an explicit `arguments` array, VSCode automatically passes the activated tree item object as the first argument to the command handler. The handlers were typed as `(manifestPath: string)` etc., but at runtime received tree item class instances (`ManifestItem`, `EpicItem`, `SubtaskItem`).

### Components

| Command | Tree Item Type | Required Properties |
|---------|---------------|---------------------|
| `wisp.explorer.orchestrate` | `ManifestItem` | `.fsPath` |
| `wisp.explorer.orchestrateEpic` | `EpicItem` | `.manifestFsPath`, `.epicName` |
| `wisp.explorer.runPipeline` | `SubtaskItem` | `.prdPath`, `.repoUrl`, `.branch` |
| `wisp.explorer.runPipelineFromPrd` | `PrdFileItem` | `.fsPath` (was already correct) |
| `wisp.explorer.generatePrd` | `ManifestItem` | `.fsPath` (was already correct) |

### Data Flow

```
VSCode Tree View Click
  → VSCode passes tree item object as first arg (no explicit arguments array in package.json contributions)
  → Command handler receives ManifestItem | EpicItem | SubtaskItem | PrdFileItem
  → Handler extracts string property (.fsPath, .manifestFsPath, .epicName, .prdPath, .repoUrl, .branch)
  → Passes string to runWithOutput() → child_process.spawn(['wisp', ...args])
```

### Data Models

All tree item classes are defined in `vscode-extension/src/treeView/items.ts`:

```typescript
class ManifestItem    { fsPath: string; manifestName: string; epics: EpicJson[] }
class EpicItem        { epicName: string; manifestFsPath: string; subtasks: SubtaskJson[] }
class SubtaskItem     { prdPath: string; repoUrl: string; manifestFsPath: string; branch: string }
class PrdFileItem     { fsPath: string }
```

## File Structure

```
vscode-extension/src/
└── extension.ts     # Only file modified — handler signatures + property access
```

No new files created. No changes to `package.json`, `items.ts`, `provider.ts`, or any Rust source.

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Fix location | Handler parameter types only | Root cause is in handler signatures; no menu contribution changes needed | Adding explicit `arguments` arrays in package.json (more fragile, duplicates data already on the item) |
| Type tightening | Use specific item classes | Provides compile-time safety, documents intent | Keep `{ fsPath: string }` duck types (passes but loses specificity) |
| Command Palette paths | No change | These paths use `pickManifestFile()` / `pickPrdFile()` which return real strings; not affected | N/A |

## Dependencies

No new packages or external services. Existing `vscode`, `items.ts` types only.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Command Palette regression | Medium | Palette flows use `pickManifestFile()` / `pickPrdFile()` which return strings — not tree items; type is compatible since strings don't go through these handlers |
| TypeScript strict mode catches | Low | Build confirmed passing with `npm run compile` |
| `item.branch` fallback | Low | `item.branch || 'main'` preserves the original fallback pattern |

## Implementation Tasks

All tasks completed by Developer agent (single-file change):

1. Add import for `ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFileItem` from `./treeView/items` — ✅ done
2. Fix `wisp.explorer.orchestrate` handler: `(manifestPath: string)` → `(item: ManifestItem)`, use `item.fsPath` — ✅ done
3. Fix `wisp.explorer.orchestrateEpic` handler: `(manifestPath: string, epicName: string)` → `(item: EpicItem)`, use `item.manifestFsPath` and `item.epicName` — ✅ done
4. Fix `wisp.explorer.runPipeline` handler: `(prdPath: string, repoUrl: string, branch: string)` → `(item: SubtaskItem)`, use `item.prdPath`, `item.repoUrl`, `item.branch` — ✅ done
5. Tighten `wisp.explorer.runPipelineFromPrd`: `{ fsPath: string }` → `PrdFileItem` — ✅ done (was already functionally correct)
6. Tighten `wisp.explorer.generatePrd`: `{ fsPath: string }` → `ManifestItem` — ✅ done (was already functionally correct)

## Security Considerations

No security impact. Fix is purely a TypeScript type correction in a local VSCode extension. No auth, no data validation changes, no network paths affected.

## Performance Considerations

No performance impact. Handler invocation path is unchanged; only the parameter binding changes.
