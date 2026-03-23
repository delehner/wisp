# Test Report: VSCode Extension Sidebar Tree View & Explorer

## Summary
- Total tests: 96 (21 new for this PRD; 75 pre-existing from PRD 01)
- Passed: 96
- Failed: 0
- Coverage: 94.96% statements, 76.85% branches, 92% functions, 94.89% lines

## Test Suites

### Unit Tests — Tree View (new in this PRD)

#### `treeView.test.ts` — WispTreeDataProvider
| Test | Description | Status |
|------|-------------|--------|
| getChildren(undefined) — two sections | Returns exactly SectionItem("Manifests") and SectionItem("PRDs") | ✅ |
| getChildren(SectionItem("Manifests")) — valid JSON | Returns ManifestItem with correct manifestName | ✅ |
| getChildren(SectionItem("Manifests")) — malformed JSON | Returns ErrorItem with "⚠ Invalid JSON" label | ✅ |
| getChildren(SectionItem("Manifests")) — no files | Returns empty array | ✅ |
| getChildren(SectionItem("Manifests")) — no name field | Falls back to filename (without .json extension) | ✅ |
| getChildren(ManifestItem) — two epics | Returns correct EpicItem count with epicName set | ✅ |
| getChildren(ManifestItem) — empty epics | Returns empty array | ✅ |
| getChildren(EpicItem) — subtasks | Returns SubtaskItem with prdPath and repoUrl | ✅ |
| legacy key — "orders" alias | Reads epics from `orders` key when `epics` absent | ✅ |
| legacy key — "prds" alias on EpicItem | Reads subtasks from `prds` key when `subtasks` absent | ✅ |
| PRD title/status extraction | Reads first 10 lines; tooltip contains title and status | ✅ |
| getChildren(PrdFolderItem) | Returns PrdFileItem for each URI in the folder | ✅ |
| refresh() | Fires onDidChangeTreeData with undefined | ✅ |

#### `watcher.test.ts` — WispFileWatcher
| Test | Description | Status |
|------|-------------|--------|
| creates two watchers with correct globs | `**/manifests/*.json` and `**/prds/**/*.md` created | ✅ |
| registers all three event handlers on each watcher | onDidCreate, onDidChange, onDidDelete bound to both FSWs | ✅ |
| calls onRefresh after 500 ms debounce on file create | Fires exactly at 500 ms, not before | ✅ |
| debounces multiple rapid events into one call | Three events within window → one refresh | ✅ |
| fires onRefresh for events on the PRDs watcher | Second (prds) watcher also triggers refresh | ✅ |
| dispose() prevents pending debounce from firing | Timer cancelled; onRefresh not called after dispose | ✅ |
| dispose() calls dispose() on each underlying FSW | Both inner watchers are cleaned up | ✅ |
| allows multiple independent refresh cycles | Each settled event window produces one refresh | ✅ |

### Regression — Pre-existing Test Suites (PRD 01)
All 75 tests from `wispCli`, `statusBar`, `commandUtils`, `orchestrate`, `pipeline`, `run`, `generate`, and `monitor` continue to pass with no regressions.

## Coverage Report
| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| statusBar.ts | 100% | 100% | 100% | 100% |
| wispCli.ts | 90.2% | 92.9% | 81.3% | 90.2% |
| generate.ts | 95.6% | 86.7% | 100% | 95.6% |
| monitor.ts | 95.2% | 60% | 100% | 95.2% |
| orchestrate.ts | 94.1% | 66.7% | 100% | 94.1% |
| pipeline.ts | 96% | 81.8% | 100% | 96% |
| run.ts | 95.7% | 80% | 100% | 95.7% |
| utils.ts | 91.5% | 66.7% | 83.3% | 91.2% |
| treeView/items.ts | 100% | 50% | 100% | 100% |
| treeView/provider.ts | 94.5% | 77.4% | 90.9% | 94.5% |
| treeView/watcher.ts | 100% | 100% | 100% | 100% |
| **All files** | **94.96%** | **76.85%** | **92%** | **94.89%** |

### Coverage Notes
- `items.ts` branch 50%: the uncovered branches are null-coalescing `??` fallbacks in `SubtaskItem` (line 64: `prdPath ?? prdPath`) and `PrdFileItem` (line 89). These require a `split('/').pop()` returning `undefined`, which is impossible for a non-empty string — dead code by construction.
- `provider.ts` lines 30, 67, 95, 148: line 30 is `getTreeItem()` return (only called by VS Code host, not testable in unit context); 67 is the `[]` fallback for unknown item type; 95 is `'(root)'` folder fallback; 148 is the `catch` return `{ title: '', status: '' }` for unreadable PRD files.
- `watcher.ts`: 100% across all metrics.

## Bugs Found
None. All PRD acceptance criteria verified against implementation:
- FR-1: Wisp Explorer view registered in `extension.ts` with correct viewsContainer and `wispSection` contextValue
- FR-2: Manifest nodes parse `name`, fall back to filename, show epics; malformed JSON → ErrorItem
- FR-3: PRD folder grouping by immediate subdirectory; click-to-open via `wisp.explorer.openFile` command on `PrdFileItem`
- FR-4: Context menu `when` clauses in `package.json` use `wispManifest`, `wispEpic`, `wispSubtask` values set by `CONTEXT_VALUES`
- FR-5: `WispFileWatcher` watches both globs, debounces at 500 ms, disposed with extension lifecycle

## Recommendations
- `items.ts` branch coverage could reach ~75% by adding a test that constructs a `SubtaskItem` with a prdPath containing no `/` separator (e.g. `"filename.md"`). Low value given the dead-code nature.
- Consider adding `coverageThreshold` to `jest.config.js` (e.g. ≥90% statements, ≥70% branches) to protect regressions going forward.
- `provider.ts` line 67 (`return []` for unknown item type) could be tested by passing an arbitrary `WispTreeItem` subclass — low priority since the TypeScript type system already prevents this in practice.
