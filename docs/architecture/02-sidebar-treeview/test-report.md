# Test Report: VSCode Extension Sidebar Tree View & Explorer

## Summary
- Total tests: 100 (30 treeView/watcher; 70 pre-existing from PRD 01 and other modules)
- Passed: 100 / 100
- Failed: 0
- Coverage (treeView module): 100% statements · 100% functions · 100% lines · 83.72% branches

> Remaining branch gaps are unreachable defensive `??` fallbacks in TypeScript (e.g. `split('/').pop() ?? path`) — not testable without mocking built-in String methods.

---

## Test Suites

### Unit Tests — WispTreeDataProvider (`treeView.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| getChildren(undefined) — returns exactly two SectionItems | Root returns Manifests + PRDs sections | ✅ |
| Manifests section — returns ManifestItem for valid JSON | Parses manifest and creates ManifestItem with correct name | ✅ |
| Manifests section — returns ErrorItem for malformed JSON | Graceful degradation with ⚠ error node | ✅ |
| Manifests section — returns empty array when no manifests found | Empty state handled | ✅ |
| Manifests section — uses filename as manifest name when name field absent | Fallback to filename without extension | ✅ |
| ManifestItem — returns correct EpicItem count | Two epics produce two EpicItems | ✅ |
| ManifestItem — returns empty array for manifest with no epics | Empty epics list handled | ✅ |
| EpicItem — returns correct SubtaskItem count | Subtasks map to SubtaskItems with correct prdPath/repoUrl | ✅ |
| Legacy keys — reads "orders" key when "epics" is absent | Backward-compatible manifest parsing | ✅ |
| Legacy keys — reads "prds" key on EpicItem when "subtasks" is absent | Backward-compatible subtask parsing | ✅ |
| PRD title/status extraction — extracts from first 10 lines | Title and status parsed from markdown | ✅ |
| PrdFolderItem — returns PrdFileItems for folder URIs | Multiple PRD files in folder | ✅ |
| refresh() — fires onDidChangeTreeData event | EventEmitter fires with undefined | ✅ |
| getTreeItem() — returns element unchanged | Identity pass-through | ✅ |
| getChildren(unknown element) — returns empty array | Unknown element type handled safely | ✅ |
| PRDs section — empty array when no PRD files found | Empty PRDs state | ✅ |
| PRD files at root — groups into "(root)" folder | Files directly under prds/ get (root) dirName | ✅ |
| _extractPrdMeta error handling — returns empty on readFile rejection | Catch block graceful degradation | ✅ |
| PrdFileItem — uses filename as label when title is empty | Fallback label when no # heading | ✅ |
| PrdFileItem — shows "Unknown" status in tooltip when absent | Fallback status label | ✅ |
| SubtaskItem — uses full prdPath as label when no slash | Fallback label when path has no / | ✅ |
| ErrorItem — correct label prefix and contextValue | ⚠ prefix and wispError context | ✅ |

### Unit Tests — WispFileWatcher (`watcher.test.ts`)

| Test | Description | Status |
|------|-------------|--------|
| creates two file system watchers with correct globs | `**/manifests/*.json` and `**/prds/**/*.md` | ✅ |
| registers onDidCreate, onDidChange, onDidDelete on each watcher | All three event handlers wired | ✅ |
| calls onRefresh after 500ms debounce on file create | Debounce timing verified | ✅ |
| debounces multiple rapid events into a single onRefresh call | Rapid create+change+delete collapses to one call | ✅ |
| fires onRefresh for events on the second (PRDs) watcher too | Both watchers trigger refresh | ✅ |
| dispose() prevents pending debounce from firing onRefresh | Cleanup clears pending timer | ✅ |
| dispose() calls dispose() on each underlying file system watcher | All resources released | ✅ |
| allows multiple independent refresh cycles after debounce settles | Subsequent events work after first cycle | ✅ |

---

## Coverage Report

| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| items.ts | 100% | 80% | 100% | 100% |
| provider.ts | 100% | 83.87% | 100% | 100% |
| watcher.ts | 100% | 100% | 100% | 100% |
| **Total** | **100%** | **83.72%** | **100%** | **100%** |

---

## Bugs Found

None. All PRD requirements are correctly implemented and verified by tests.

---

## Recommendations

- The uncovered branches (`items.ts:64-89`, `provider.ts:49-51,82-83`) are TypeScript optional chaining fallbacks (`?? default`) that fire only when `String.prototype.split().pop()` returns `undefined` — not achievable without mocking built-in methods. No action needed.
- Consider adding E2E tests with the VS Code Extension Test Runner (`@vscode/test-electron`) to validate Activity Bar registration and context menu wiring in a real VS Code host. Out of scope for the unit test suite.
