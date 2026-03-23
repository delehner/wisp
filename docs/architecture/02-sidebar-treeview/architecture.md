# Architecture: VSCode Extension Sidebar Tree View & Explorer

## Overview

Add a Wisp Explorer panel to the VS Code Activity Bar with a tree view showing the workspace's manifests and PRDs. Users can browse epics, subtasks, and PRD files, launch pipelines from context menus, and open PRDs in the editor with a click — without touching the file system or command line.

This feature is entirely additive: it extends `vscode-extension/` with a new `src/treeView/` module, new commands, and `package.json` contribution points. It depends on PRD 01's commands being registered (`wisp.orchestrate`, `wisp.pipeline`).

---

## System Design

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `WispTreeDataProvider` | `src/treeView/provider.ts` | Implements `vscode.TreeDataProvider<WispTreeItem>`; provides root sections and lazy children |
| Item classes | `src/treeView/items.ts` | `WispTreeItem` base + `SectionItem`, `ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFolderItem`, `PrdFileItem`, `ErrorItem` |
| `WispFileWatcher` | `src/treeView/watcher.ts` | Wraps `vscode.workspace.createFileSystemWatcher`; debounces refresh by 500ms |
| `resources/wisp-icon.svg` | `resources/wisp-icon.svg` | 16×16 single-color SVG for the Activity Bar container icon |

### Data Flow

```
activate()
  → WispTreeDataProvider instantiated
  → vscode.window.createTreeView('wispExplorer', { treeDataProvider })
  → WispFileWatcher created → fires provider._onDidChangeTreeData on manifest/PRD changes

getChildren(undefined)
  → returns [SectionItem("Manifests"), SectionItem("PRDs")]

getChildren(SectionItem("Manifests"))
  → vscode.workspace.findFiles('**/manifests/*.json')
  → for each URI: readFile async → JSON.parse → ManifestItem | ErrorItem

getChildren(ManifestItem)
  → manifest.epics[] → EpicItem[]

getChildren(EpicItem)
  → epic.subtasks[] → SubtaskItem[] (label = basename(subtask.prd), description = repo URLs)

getChildren(SectionItem("PRDs"))
  → vscode.workspace.findFiles('**/prds/**/*.md')
  → group by immediate subdirectory → PrdFolderItem[]

getChildren(PrdFolderItem)
  → files in folder → PrdFileItem[] (reads first 10 lines for title/status)

getChildren(leaf nodes)
  → []
```

### Data Models

```typescript
// Manifest JSON shape (both "epics"/"orders" and "subtasks"/"prds" keys accepted)
interface ManifestJson {
  name?: string;
  description?: string;
  epics?: EpicJson[];    // canonical key
  orders?: EpicJson[];   // legacy alias
}

interface EpicJson {
  name?: string;
  subtasks?: SubtaskJson[];  // canonical key
  prds?: SubtaskJson[];      // legacy alias
}

interface SubtaskJson {
  prd: string;
  repositories?: Array<{ url: string; branch?: string }>;
}
```

PRD title/status are extracted from the first 10 lines of each `.md` file:
- **Status**: match `/^>\s*\*\*Status\*\*:\s*(.+)/` in the first 10 lines
- **Title**: first line matching `/^#\s+(.+)/`

### Tree Node Hierarchy

```
[root]
├── SectionItem("Manifests")          contextValue: "wispSection"
│   ├── ManifestItem(name, fsPath)    contextValue: "wispManifest"
│   │   └── EpicItem(name, epicIdx)   contextValue: "wispEpic"
│   │       └── SubtaskItem(prd,repos) contextValue: "wispSubtask"
│   └── ErrorItem("⚠ Invalid JSON")   contextValue: "wispError"
└── SectionItem("PRDs")               contextValue: "wispSection"
    └── PrdFolderItem(dirName)        contextValue: "wispPrdFolder"
        └── PrdFileItem(fsPath)       contextValue: "wispPrd"
```

---

## File Structure

```
vscode-extension/
├── resources/
│   └── wisp-icon.svg               # Activity Bar icon (16x16, currentColor)
├── src/
│   ├── treeView/
│   │   ├── items.ts                # WispTreeItem base + all subclasses
│   │   ├── provider.ts             # WispTreeDataProvider
│   │   └── watcher.ts              # WispFileWatcher (debounced FSW)
│   ├── extension.ts                # Updated: register tree view + new commands
│   └── __mocks__/vscode.ts         # Updated: TreeItem, createTreeView, workspace.fs, FSW
└── src/__tests__/
    └── treeView.test.ts            # Unit tests for provider and item helpers
```

No new directories are needed outside `src/treeView/` and `resources/`.

---

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Two root sections vs. flat manifest list | Virtual `SectionItem` nodes at root | PRD spec requires both a "Manifests" section and a "PRDs" section; virtual nodes avoid API gymnastics | Separate registered views (more package.json complexity, harder to order) |
| Lazy children loading | `getChildren()` reads files on expand, not at startup | Keeps initial render < 200ms; avoids reading all PRD files upfront | Eager load at activation — fails the 200ms constraint for 100 PRDs |
| Single `EventEmitter` for refresh | `vscode.EventEmitter<WispTreeItem | undefined>` fired with `undefined` (full refresh) | Simple; selective refresh is unnecessary given debounce + small tree | Per-item events — premature optimization |
| Debounce interval | 500ms | PRD spec says "debounce refresh by 500ms"; avoids thrash during pipeline runs | 100ms (too frequent), 1s (feels slow) |
| Manifest JSON parsing in TS | `JSON.parse` with try/catch → `ErrorItem` on failure | No new dependencies; error nodes match PRD requirement for malformed JSON | Validate with a schema library — no dep needed here |
| Legacy key aliases | Support both `epics`/`orders` and `subtasks`/`prds` | Rust `Manifest` deserialization accepts both (serde aliases); extension must match | Only support new keys — would break existing manifests |
| Command naming | `wisp.explorer.*` prefix | Avoids collision with PRD 01 commands; clear namespace | Reusing `wisp.orchestrate` directly with args — can't pre-fill from context menu without a wrapper |
| Activity Bar container | Custom `viewsContainers.activitybar` entry | Gives Wisp its own icon slot; cleaner than embedding under Explorer | `contributes.views.explorer` — buries the view inside the file explorer |

---

## Dependencies

No new npm packages required. Uses VS Code extension API only:
- `vscode.window.createTreeView` (already available)
- `vscode.workspace.fs.readFile` (async; already available)
- `vscode.workspace.findFiles` (already used in `commands/utils.ts`)
- `vscode.workspace.createFileSystemWatcher` (available since VS Code 1.0)

---

## API Contracts

### `WispTreeDataProvider`

```typescript
export class WispTreeDataProvider
  implements vscode.TreeDataProvider<WispTreeItem> {

  readonly onDidChangeTreeData: vscode.Event<WispTreeItem | undefined | null>;

  getTreeItem(element: WispTreeItem): vscode.TreeItem;
  getChildren(element?: WispTreeItem): Promise<WispTreeItem[]>;

  /** Called by WispFileWatcher to trigger a full tree refresh. */
  refresh(): void;

  dispose(): void;
}
```

### `WispFileWatcher`

```typescript
export class WispFileWatcher implements vscode.Disposable {
  constructor(onRefresh: () => void);
  dispose(): void;
}
```

Internally creates two watchers:
- `**/manifests/*.json` — created, changed, deleted
- `**/prds/**/*.md` — created, changed, deleted

### Item classes (contextValue strings are the contract with `package.json`)

| Class | `contextValue` | `collapsibleState` |
|-------|---------------|-------------------|
| `SectionItem` | `"wispSection"` | `Expanded` |
| `ManifestItem` | `"wispManifest"` | `Collapsed` |
| `EpicItem` | `"wispEpic"` | `Collapsed` |
| `SubtaskItem` | `"wispSubtask"` | `None` |
| `PrdFolderItem` | `"wispPrdFolder"` | `Collapsed` |
| `PrdFileItem` | `"wispPrd"` | `None` |
| `ErrorItem` | `"wispError"` | `None` |

### New Commands

| Command ID | Triggered from | Args passed |
|-----------|---------------|------------|
| `wisp.explorer.refresh` | Toolbar button | none |
| `wisp.explorer.openFile` | Context menu / click | `fsPath: string` |
| `wisp.explorer.orchestrate` | Context menu on `ManifestItem` | `manifestPath: string` |
| `wisp.explorer.orchestrateEpic` | Context menu on `EpicItem` | `manifestPath: string, epicName: string` |
| `wisp.explorer.runPipeline` | Context menu on `SubtaskItem` | `prdPath: string, repoUrl: string` |

`wisp.explorer.orchestrate` delegates to the existing `wisp.orchestrate` flow but bypasses the file picker (manifest path is already known). Similarly `wisp.explorer.runPipeline` delegates to `wisp.pipeline` logic.

---

## `package.json` Changes

```jsonc
// contributes.viewsContainers.activitybar
{
  "id": "wisp-explorer",
  "title": "Wisp Explorer",
  "icon": "resources/wisp-icon.svg"
}

// contributes.views["wisp-explorer"]
{
  "id": "wispExplorer",
  "name": "Wisp Explorer",
  "when": "true"
}

// contributes.commands (additions)
[
  { "command": "wisp.explorer.refresh",         "title": "Refresh",                          "icon": "$(refresh)" },
  { "command": "wisp.explorer.openFile",         "title": "Open File" },
  { "command": "wisp.explorer.orchestrate",      "title": "Run Orchestrate" },
  { "command": "wisp.explorer.orchestrateEpic",  "title": "Run Orchestrate (this epic only)" },
  { "command": "wisp.explorer.runPipeline",      "title": "Run Pipeline" }
]

// contributes.menus["view/title"]
[
  { "command": "wisp.explorer.refresh", "when": "view == wispExplorer", "group": "navigation" }
]

// contributes.menus["view/item/context"]
[
  { "command": "wisp.explorer.orchestrate",     "when": "viewItem == wispManifest", "group": "inline" },
  { "command": "wisp.explorer.openFile",        "when": "viewItem == wispManifest" },
  { "command": "wisp.explorer.orchestrateEpic", "when": "viewItem == wispEpic",     "group": "inline" },
  { "command": "wisp.explorer.runPipeline",     "when": "viewItem == wispSubtask",  "group": "inline" },
  { "command": "wisp.explorer.openFile",        "when": "viewItem == wispPrd" }
]
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Workspace with 100+ PRDs causes slow initial render | Medium | Lazy children loading — only expand on demand; section items defer file I/O |
| File watcher fires too frequently during pipeline runs | Low | 500ms debounce in `WispFileWatcher` |
| `contextValue` string mismatch between TypeScript and `package.json` | Medium | Strings are defined as `const` exports in `items.ts` and referenced in both places; Reviewer must verify |
| Manifest JSON with legacy `orders`/`prds` keys not parsed | Low | Provider reads both key names with `?? []` fallback pattern |
| `vscode.workspace.fs` unavailable in test environment | Low | Extend `__mocks__/vscode.ts` with `workspace.fs.readFile` mock; test data is injected via mock |
| Tree view not disposed on deactivate → memory leak | Low | `createTreeView` returns a `Disposable`; push to `context.subscriptions` or dispose manually in `deactivate()` |

---

## Implementation Tasks

Ordered for the Developer agent — each task is independent of the next unless marked *(depends on X)*:

1. **Create `resources/wisp-icon.svg`**
   - A 16×16 SVG using `currentColor` fill so it adapts to VS Code themes
   - Acceptance: file exists at `vscode-extension/resources/wisp-icon.svg`; renders visibly in Activity Bar

2. **Update `package.json`** *(depends on SVG path from task 1)*
   - Add `contributes.viewsContainers.activitybar` with `wisp-explorer` container
   - Add `contributes.views["wisp-explorer"]` with `wispExplorer` view
   - Add 5 new commands (`wisp.explorer.*`) to `contributes.commands`
   - Add `view/title` menu entry for refresh button
   - Add `view/item/context` entries for all 5 context menu items
   - Add `"vscode": "^1.85.0"` engine minimum if not already >= that version
   - Acceptance: `vsce package` succeeds; context menu entries appear in the correct tree item right-clicks

3. **Create `src/treeView/items.ts`**
   - Export `CONTEXT_VALUES` const object with all `contextValue` string literals
   - Implement `WispTreeItem extends vscode.TreeItem` base class
   - Implement `SectionItem`, `ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFolderItem`, `PrdFileItem`, `ErrorItem`
   - `PrdFileItem` must set `command` to `{ command: 'wisp.explorer.openFile', arguments: [fsPath] }`
   - All items must set meaningful `tooltip` and `description` for accessibility
   - Acceptance: TypeScript compiles; no `any` types

4. **Create `src/treeView/provider.ts`** *(depends on task 3)*
   - Implement `WispTreeDataProvider` with `EventEmitter` and `refresh()` method
   - `getChildren(undefined)` returns two `SectionItem` instances
   - `getChildren(SectionItem("Manifests"))` uses `vscode.workspace.findFiles` + async `vscode.workspace.fs.readFile` + `JSON.parse`
   - Handle both `epics`/`orders` and `subtasks`/`prds` manifest keys
   - `getChildren(SectionItem("PRDs"))` uses `findFiles` + groups by subdirectory
   - `getChildren(PrdFolderItem)` reads first 10 lines of each `.md` for title/status
   - Empty state: when `getChildren(SectionItem("Manifests"))` returns `[]`, VS Code shows the `emptyViewText` (set in `createTreeView` options)
   - Acceptance: TypeScript compiles; all async reads use `vscode.workspace.fs`, no `fs.readFileSync`

5. **Create `src/treeView/watcher.ts`** *(depends on task 4)*
   - `WispFileWatcher` creates two `FileSystemWatcher` instances
   - Debounce via `setTimeout`/`clearTimeout` pattern (no lodash needed)
   - Dispose both watchers and clear pending timers in `dispose()`
   - Acceptance: TypeScript compiles; watcher fires `onRefresh` once per burst of file changes

6. **Update `src/extension.ts`** *(depends on tasks 3–5)*
   - Import and instantiate `WispTreeDataProvider` and `WispFileWatcher`
   - Call `vscode.window.createTreeView('wispExplorer', { treeDataProvider: provider, showCollapseAll: true })`; push result to `context.subscriptions`
   - Register `wisp.explorer.refresh` → `provider.refresh()`
   - Register `wisp.explorer.openFile(fsPath)` → `vscode.workspace.openTextDocument(fsPath).then(showTextDocument)`
   - Register `wisp.explorer.orchestrate(manifestPath)` → reuse `runWithOutput` pattern from `commands/orchestrate.ts`
   - Register `wisp.explorer.orchestrateEpic(manifestPath, epicName)` → `wisp orchestrate --manifest <path> --epic <name>`
   - Register `wisp.explorer.runPipeline(prdPath, repoUrl)` → `wisp pipeline --prd <path> --repo <url>`
   - Dispose `WispFileWatcher` in `deactivate()` (or push to `context.subscriptions`)
   - Acceptance: all existing tests pass; extension activates without error

7. **Update `src/__mocks__/vscode.ts`** *(depends on tasks 3–4, needed for task 8)*
   - Add `TreeItem` class mock with `label`, `collapsibleState`, `contextValue`, `tooltip`, `description`, `iconPath`, `command`
   - Add `TreeItemCollapsibleState` enum: `None: 0, Collapsed: 1, Expanded: 2`
   - Add `window.createTreeView` mock returning `{ dispose: jest.fn() }`
   - Add `workspace.fs.readFile` mock returning `Promise<Uint8Array>`
   - Add `workspace.createFileSystemWatcher` mock returning `{ onDidCreate: jest.fn(), onDidChange: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() }`
   - Acceptance: all existing tests still pass with updated mock

8. **Create `src/__tests__/treeView.test.ts`** *(depends on tasks 3–4, 7)*
   - Test `getChildren(undefined)` returns exactly 2 `SectionItem` instances
   - Test `getChildren(SectionItem("Manifests"))` with a mocked `workspace.fs.readFile` returning valid JSON → correct `ManifestItem` count
   - Test `getChildren(SectionItem("Manifests"))` with malformed JSON → returns `ErrorItem`
   - Test `getChildren(ManifestItem)` → correct `EpicItem` count matching `epics` array
   - Test `getChildren(EpicItem)` → correct `SubtaskItem` count
   - Test PRD title/status extraction from first 10 lines of markdown
   - Test legacy `orders`/`prds` key support
   - Test empty manifest (no epics) → empty children
   - Acceptance: `npm test` passes; all new tests green

---

## Security Considerations

- All file reads are scoped to `vscode.workspace.findFiles` patterns — no arbitrary path traversal
- JSON parsing from manifest files: use try/catch and display `ErrorItem` on parse failure — no eval, no dynamic code
- Command arguments passed to `wisp` CLI are derived from parsed manifest data; no user-typed strings are shell-interpolated

## Performance Considerations

- Initial render: only two `SectionItem` nodes at root; no file I/O until expanded → well within 200ms target
- Manifest parse: async `vscode.workspace.fs.readFile` keeps UI thread unblocked
- PRD title extraction: limited to first 10 lines per file (PRD constraint)
- File watcher debounce: 500ms prevents excessive refreshes during pipeline runs writing many files
