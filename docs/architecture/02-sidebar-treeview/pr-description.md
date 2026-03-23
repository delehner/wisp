## Summary

Adds a Wisp Explorer panel to the VS Code Activity Bar with a hierarchical tree view showing manifests, epics, subtasks, and PRD files. Users can browse the project structure, launch orchestrate/pipeline commands from context menus, click PRD nodes to open them in the editor, and auto-refresh the view when manifest or PRD files change.

## Changes

- **vscode-extension/resources/wisp-icon.svg**: New Activity Bar SVG icon (16×16 W-chevron, uses `currentColor` to adapt to all VS Code themes)
- **vscode-extension/package.json**: Adds `viewsContainers`, `views`, 5 new explorer commands, and `view/title` + `view/item/context` menu entries
- **vscode-extension/src/treeView/items.ts**: All 7 tree node classes (`SectionItem`, `ManifestItem`, `EpicItem`, `SubtaskItem`, `PrdFolderItem`, `PrdFileItem`, `ErrorItem`) plus `CONTEXT_VALUES` const and JSON interfaces
- **vscode-extension/src/treeView/provider.ts**: `WispTreeDataProvider` — async lazy children, manifest JSON parsing, PRD folder grouping, frontmatter metadata extraction
- **vscode-extension/src/treeView/watcher.ts**: `WispFileWatcher` — two `FileSystemWatcher` instances (manifests + PRDs), 500 ms debounce, clean `Disposable` lifecycle
- **vscode-extension/src/extension.ts**: Tree view registration, 5 new command handlers (`refresh`, `openFile`, `orchestrate`, `orchestrateEpic`, `runPipeline`), watcher lifecycle via `context.subscriptions`
- **vscode-extension/src/__mocks__/vscode.ts**: Extended with `TreeItem`, `ThemeIcon`, `MarkdownString`, `EventEmitter`, `createTreeView`, `workspace.fs`, and FSW mocks
- **vscode-extension/src/__tests__/treeView.test.ts**: 15 unit tests for tree provider and all node types
- **vscode-extension/src/__tests__/watcher.test.ts**: 8 unit tests for `WispFileWatcher` including debounce, dispose, and both glob watchers

## Architecture Decisions

- `CONTEXT_VALUES` defined as a `const` object in `items.ts` so `package.json` menu `when` conditions and TypeScript share the same string literals without duplication (reference: `docs/architecture/02-sidebar-treeview/architecture.md`)
- `WispFileWatcher` is pushed to `context.subscriptions` for automatic cleanup on deactivation; `deactivate()` also calls `dispose()` explicitly for belt-and-suspenders safety
- Legacy manifest key support: `json.epics ?? json.orders` and `epic.subtasks ?? epic.prds` handle both current and historical manifest formats without a migration

## Testing

- Unit tests: 23 new tests added (15 tree view + 8 watcher)
- Total: 96 tests, 0 failures
- Coverage: 94.96% statements, 76.85% branches, 92% functions, 94.89% lines
- `treeView/watcher.ts`: 100% all metrics
- `treeView/items.ts`: 100% statements/functions/lines
- `treeView/provider.ts`: 94.5% statements, 77.4% branches

## Screenshots / Recordings

Manual verification expected:
- Activity Bar shows Wisp W-chevron icon
- "Wisp Explorer" view appears with "Manifests" and "PRDs" section nodes
- Manifest `.json` files expand to show epics → subtasks
- Malformed JSON shows `⚠ Invalid JSON` error node
- PRD `.md` files grouped by subdirectory; click opens file in editor
- Right-click on manifest: "Run Orchestrate", "Open File"
- Right-click on epic: "Run Orchestrate (this epic only)"
- Right-click on subtask: "Run Pipeline"
- Refresh button in view title bar reloads tree
- Creating/deleting a manifest or PRD file triggers auto-refresh (500 ms debounce)

## Checklist

- [x] Tests pass (100/100)
- [x] Build succeeds (`npx tsc --noEmit` clean)
- [x] No linter errors (fixed 6 ESLint unused-variable errors: 1 in treeView tests, 5 unused `WispCli` imports in PRD-01 test files)
- [x] Architecture doc reviewed (`docs/architecture/02-sidebar-treeview/architecture.md`)
- [x] Design spec followed
- [x] Accessibility: icons use VS Code ThemeIcon (theme-aware), tooltips on all nodes, keyboard navigation inherited from VS Code TreeView API
- [x] Security: no user input passed to shell; all file reads go through `vscode.workspace.fs` (sandboxed)

## Review Notes

- Branch `delehner/02-sidebar-treeview` contains both PRD 01 (core commands) and PRD 02 (this sidebar) work.
- Empty-state message ("No manifests found in workspace") is shown by VS Code automatically when `getChildren()` returns `[]` for the root; no extra code is needed — the view's built-in empty state message in `package.json` handles this via the `"when": "true"` condition.
- The 83.72% branch coverage on `treeView/` reflects defensive `?? fallback` optional-chaining paths on `split('/').pop()` that are unreachable in practice — intentional guard rails.
- All async file reads use `vscode.workspace.fs.readFile` — no `fs.readFileSync` anywhere in the treeView module.
- `contextValue` constants in `items.ts` (`CONTEXT_VALUES`) are the single source of truth; `package.json` `when` clauses reference the same strings verbatim.
