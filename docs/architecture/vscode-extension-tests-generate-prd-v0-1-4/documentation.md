---
name: VSCode Extension — wisp.explorer.generatePrd optional-item tests (v0.1.4)
description: Documents the item-absent flow added to wisp.explorer.generatePrd and its test coverage
type: reference
---

# VSCode Extension: `wisp.explorer.generatePrd` — Item-Absent Flow (v0.1.4)

## Overview

Version 0.1.4 of the Wisp VSCode extension changed `wisp.explorer.generatePrd` from requiring a `ManifestItem` argument (right-click on tree item) to accepting an **optional** `item?: ManifestItem`. This allows the command to also be triggered from the view/title bar button, where no tree item is selected.

## Code Change

**File**: `vscode-extension/src/extension.ts` (lines 263–283)

```typescript
// Before (required item)
async (item: ManifestItem) => {
  ...
  const args = await promptGeneratePrdArgs(cwd, item.fsPath);

// After (optional item — v0.1.4)
async (item?: ManifestItem) => {
  ...
  const args = await promptGeneratePrdArgs(cwd, item?.fsPath);
```

When `item` is `undefined` (view/title button invocation), `item?.fsPath` evaluates to `undefined`, which causes `promptGeneratePrdArgs` to prompt the user for a manifest path via `showInputBox`.

## How `promptGeneratePrdArgs` Handles the Optional Manifest

**File**: `vscode-extension/src/commands/generate.ts`

When `prefilledManifest` is `undefined`, the function shows an additional `InputBox` before the repo URL loop:

```typescript
const manifestInput = await vscode.window.showInputBox({
  prompt: 'Manifest JSON path',
  value: './manifests/project.json',
  validateInput: (val) => (val.trim() ? undefined : 'Manifest path is required'),
});
if (manifestInput === undefined) {
  return null;  // user cancelled → handler returns early, no spawn
}
```

### Full prompt sequence when `item` is absent

| Step | Prompt | Cancel behaviour |
|------|--------|-----------------|
| 1 | `'Project description'` | returns `null` → no spawn |
| 2 | `'Output directory for generated PRDs'` | returns `null` → no spawn |
| 3 | `'Manifest JSON path'` *(new, item-absent only)* | returns `null` → no spawn |
| 4+ | `'Repo URL N (leave empty to finish)'` | empty string ends loop |

When `item` is present (tree-item right-click), step 3 is skipped — `item.fsPath` is forwarded directly.

## CLI Invocation

Regardless of how the manifest path is obtained, the CLI is spawned with an array of arguments (no shell interpolation):

```
wisp generate prd
  --output <output>
  --manifest <manifestPath>
  --description <description>
  [--repo <url> [--context <ctx>]] ...
```

## Test Coverage

**File**: `vscode-extension/src/__tests__/explorerCommands.test.ts`

Four new tests were added to the `wisp.explorer.generatePrd` describe block to cover the item-absent path:

### FR-1: Happy path (item absent)

```typescript
it('item-absent happy path: prompts for manifest and spawns with typed path', async () => { ... })
```

- Mocks: description → output dir → manifest path → empty repo URL
- Asserts `showInputBox` called with `{ prompt: 'Manifest JSON path' }`
- Asserts `--manifest ./manifests/project.json` appears in spawn args
- Asserts no `[object Object]` in spawn args

### FR-2: Manifest InputBox cancelled

```typescript
it('item-absent: returns early without spawning when manifest InputBox is cancelled', async () => { ... })
```

- Mocks: description → output dir → `undefined` (cancel)
- Asserts `cp.spawn` not called

### FR-3: First prompt cancelled

```typescript
it('item-absent: returns early without spawning when first prompt is cancelled', async () => { ... })
```

- Mocks: `undefined` for description (first prompt)
- Asserts `cp.spawn` not called

### FR-4: No workspace folder (item absent)

```typescript
it('item-absent: shows error and does not spawn when no workspace folder is open', async () => { ... })
```

- Sets `workspaceFolders = undefined`
- Asserts `showErrorMessage('Wisp AI: No workspace folder open.')` called
- Asserts `cp.spawn` not called

## Test Results

```
Tests: 166 passed, 166 total  (162 pre-existing + 4 new)
Time:  ~2.1 s
```

All tests pass. `npm test` exits 0.

## Security Notes

- `cp.spawn` is always called with an **array** of arguments — no `{ shell: true }`. User-supplied values from `showInputBox` are passed as discrete array elements. Shell injection is not possible.
- Path traversal from user-typed manifest paths is an acceptable, low-severity risk for a developer tool running as the workspace user.
- The optional parameter change does not expand the command's attack surface — it only enables invocation from the view/title button in addition to the existing tree-item context menu.

## Rollback

To revert this change:

```bash
git revert <commit-sha>
```

Or manually:
1. Change `item?: ManifestItem` back to `item: ManifestItem` in `extension.ts` line 266
2. Change `item?.fsPath` back to `item.fsPath` in `extension.ts` line 272
3. Remove the `// ─── item-absent` test block (lines 359–413) from `explorerCommands.test.ts`

**Note**: If the `package.json` view/title button menu entry for `wisp.explorer.generatePrd` is not also reverted, clicking the button will throw a runtime error after rollback.

## Files Changed

| File | Change |
|------|--------|
| `vscode-extension/src/extension.ts` | `item: ManifestItem` → `item?: ManifestItem`; `item.fsPath` → `item?.fsPath` |
| `vscode-extension/src/__tests__/explorerCommands.test.ts` | 4 new item-absent test cases appended (lines 359–413) |
