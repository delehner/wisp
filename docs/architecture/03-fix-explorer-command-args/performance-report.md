# Performance Report: Fix Explorer Tree Command Arguments

## Summary

This PRD fixes command handlers in `vscode-extension/src/extension.ts` to correctly extract
string properties from VSCode tree item objects instead of passing the raw objects to the CLI.
The change is a pure correctness fix with no meaningful performance surface.

## Performance Targets

No explicit performance targets are defined in the PRD. The change affects five command
handlers (`wisp.explorer.orchestrate`, `wisp.explorer.orchestrateEpic`,
`wisp.explorer.runPipeline`, `wisp.explorer.runPipelineFromPrd`,
`wisp.explorer.generatePrd`). Each handler executes once per user click — there are no
loops, batch operations, network requests, database queries, or rendering pipelines
introduced by this fix.

## Bundle Analysis

| Chunk | Size |
|-------|------|
| `out/extension.js` (compiled) | 37,221 bytes |

The compiled bundle size is unaffected by this fix. The change removes no dependencies and
adds none; the five modified handlers each substitute a property access (`.fsPath`,
`.manifestFsPath`, `.epicName`, etc.) for an erroneous direct reference. This produces
zero net change in the minified output size.

## Query Analysis

Not applicable — no database or network I/O is involved.

## Memory Analysis

No memory leaks or unbounded allocations are introduced. The handlers are short-lived
async functions invoked by user action; they hold no references beyond their stack frame
lifetime.

## Runtime Characteristics

| Operation | Before (broken) | After (fixed) |
|-----------|----------------|--------------|
| Property extraction per click | Object passed as string (error path) | Single property access (O(1)) |
| CLI arg construction | Fails immediately with `[object Object]` | Correctly builds arg array |

The property access (e.g. `item.fsPath`) is O(1) and adds no measurable overhead to the
command dispatch path.

## Test Results

All 162 tests pass (11 test suites, 1.918 s):

```
PASS src/__tests__/explorerCommands.test.ts
PASS src/__tests__/treeView.test.ts
PASS src/__tests__/orchestrate.test.ts
... (8 more suites)
Tests: 162 passed, 162 total
```

## Recommendations

- No performance monitoring required for this change in production.
- If future work adds bulk manifest scanning or large PRD tree rendering, benchmark the
  `WispTreeDataProvider` refresh path at that time.
