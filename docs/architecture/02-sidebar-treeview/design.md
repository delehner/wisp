# Design: VSCode Extension Sidebar Tree View & Explorer

## UX Flow

### Primary Flow — Browse & Open PRD
1. User opens VS Code with a wisp workspace
2. Wisp icon appears in the Activity Bar (left sidebar)
3. User clicks the Wisp icon → "Wisp Explorer" panel slides open
4. Two collapsed sections appear: **Manifests** (auto-expanded) and **PRDs**
5. User expands a manifest node → sees epics as children
6. User expands an epic → sees subtask nodes (PRD filename + target repo)
7. User clicks a PRD file node in the **PRDs** section → file opens in the editor

### Secondary Flow — Run Orchestrate from Manifest
1. User right-clicks a manifest node → context menu appears
2. User selects **"Run Orchestrate"** → `wisp orchestrate --manifest <path>` runs in the integrated terminal

### Secondary Flow — Run Orchestrate for One Epic
1. User right-clicks an epic node → context menu appears
2. User selects **"Run Orchestrate (this epic only)"** → `wisp orchestrate --manifest <path> --epic <name>`

### Secondary Flow — Run Pipeline for One Subtask
1. User right-clicks a subtask node → context menu appears
2. User selects **"Run Pipeline"** → `wisp pipeline --prd <path> --repo <url>`

### Refresh Flow
1. User adds a new manifest JSON or PRD file to the workspace
2. Tree auto-refreshes within 500ms (file watcher debounce)
3. Alternatively, user clicks the **Refresh** button (⟳) in the view title bar

### Error Flow — Malformed Manifest
1. Manifest JSON cannot be parsed
2. A child node with label **"⚠ Invalid JSON"** appears under the manifest section
3. No crash; other manifests render normally

---

## Component Hierarchy

```
ActivityBar
  WispExplorerContainer (custom viewsContainer)
    WispExplorer (TreeView)
      [title bar]
        RefreshButton ($(refresh) icon)
      SectionItem("Manifests")         ← Expanded by default
        ManifestItem(name)
          EpicItem(epicName)
            SubtaskItem(prdBasename, repoUrl)
            SubtaskItem(...)
          EpicItem(...)
        ErrorItem("⚠ Invalid JSON")    ← shown when JSON.parse fails
      SectionItem("PRDs")              ← Collapsed by default
        PrdFolderItem(dirName)
          PrdFileItem(filename, status)
          PrdFileItem(...)
        PrdFolderItem(...)
```

---

## Component Specifications

### SectionItem
- **Purpose**: Virtual root node grouping Manifests vs. PRDs — not backed by a file
- **Label**: `"Manifests"` or `"PRDs"`
- **Icon**: `$(folder)` (closed) / `$(folder-opened)` (expanded) — VS Code sets this automatically via `ThemeIcon`
- **collapsibleState**: `Expanded` for "Manifests"; `Collapsed` for "PRDs"
- **contextValue**: `"wispSection"` (no context menu entries; not right-clickable in a meaningful way)
- **tooltip**: `"Wisp manifests in this workspace"` / `"PRD files in this workspace"`
- **description**: file count shown inline, e.g., `"3 manifests"` — populated after children load

### ManifestItem
- **Purpose**: Represents one `manifests/*.json` file; top-level workspace entry point
- **Label**: `manifest.name` from JSON, or filename stem if `name` absent
- **Icon**: `$(file-code)` (ThemeIcon — adapts to light/dark themes)
- **collapsibleState**: `Collapsed`
- **contextValue**: `"wispManifest"` (drives right-click menu)
- **description**: `manifest.description` truncated to 60 chars, or empty
- **tooltip**: Full manifest file path + description
- **Behavior**: Expanding loads epics; right-click shows "Run Orchestrate" + "Open File"

### EpicItem
- **Purpose**: Represents one epic/order within a manifest
- **Label**: `epic.name` (or `"Unnamed Epic"` if absent)
- **Icon**: `$(list-ordered)` (ThemeIcon)
- **collapsibleState**: `Collapsed`
- **contextValue**: `"wispEpic"`
- **description**: subtask count, e.g., `"2 tasks"`
- **tooltip**: `"Epic: <name> — <N> subtasks"`
- **Behavior**: Expanding loads subtasks; right-click shows "Run Orchestrate (this epic only)"

### SubtaskItem
- **Purpose**: Leaf node representing one PRD × repo pairing within an epic
- **Label**: `basename(subtask.prd)` — e.g., `"01-core-commands.md"`
- **Icon**: `$(file-text)` (ThemeIcon)
- **collapsibleState**: `None` (leaf)
- **contextValue**: `"wispSubtask"`
- **description**: first `repository.url` hostname + repo name — e.g., `"github.com/delehner/wisp"`
- **tooltip**: Full PRD path + all repository URLs
- **Behavior**: No click action (double-click opens file via command); right-click shows "Run Pipeline"

### PrdFolderItem
- **Purpose**: Groups PRD files under their immediate subdirectory name
- **Label**: Directory name — e.g., `"wisp-extension"`
- **Icon**: `$(folder)` / `$(folder-opened)`
- **collapsibleState**: `Collapsed`
- **contextValue**: `"wispPrdFolder"` (no context menu)
- **description**: file count — e.g., `"3 files"`
- **tooltip**: Full directory path

### PrdFileItem
- **Purpose**: Leaf node for a single `prds/**/*.md` file
- **Label**: Filename — e.g., `"02-sidebar-treeview.md"`
- **Icon**: Status-aware icon (see Visual Specifications → Icons)
- **collapsibleState**: `None` (leaf)
- **contextValue**: `"wispPrd"`
- **description**: PRD status from frontmatter — e.g., `"Ready"` or `"In Progress"`
- **tooltip**: PRD title (first `# Heading`) + full path + status
- **command**: `{ command: 'wisp.explorer.openFile', arguments: [fsPath] }` — click opens in editor
- **Behavior**: Single-click opens file; right-click shows "Open File"

### ErrorItem
- **Purpose**: Shown in place of a manifest's children when its JSON is malformed
- **Label**: `"⚠ Invalid JSON"`
- **Icon**: `$(error)` (ThemeIcon — red in VS Code's default themes)
- **collapsibleState**: `None`
- **contextValue**: `"wispError"` (no context menu)
- **tooltip**: Error message from `JSON.parse` exception

### RefreshButton (view title action)
- **Icon**: `$(refresh)`
- **Title**: `"Refresh"`
- **group**: `"navigation"` (places it in the view title bar inline)
- **when**: `view == wispExplorer`
- **Behavior**: Fires `wisp.explorer.refresh` → `provider.refresh()` → full tree re-render

---

## Visual Specifications

### Activity Bar Icon

File: `vscode-extension/resources/wisp-icon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">
  <!-- Stylized "W" as three downward chevrons stacked — minimal, single-color -->
  <path d="M1 3 L4 11 L8 5 L12 11 L15 3" stroke="currentColor" stroke-width="1.5"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Requirements:
- `viewBox="0 0 16 16"` — VS Code Activity Bar renders icons at 24×24 but SVG viewBox should be 16×16
- `fill="currentColor"` or `stroke="currentColor"` — inherits VS Code's icon color; adapts to light/dark/high-contrast themes
- No hardcoded color values (`#fff`, `rgb(...)`) — would break theme adaptation
- Single path; avoid gradients or clip-paths — Activity Bar icons render at small sizes

### Node Icons (Codicons)

| Node type | Codicon | Renders as |
|-----------|---------|-----------|
| SectionItem | `$(folder)` / `$(folder-opened)` | Folder icon (auto-toggled by VS Code) |
| ManifestItem | `$(file-code)` | File with `<>` symbol |
| EpicItem | `$(list-ordered)` | Numbered list |
| SubtaskItem | `$(file-text)` | Plain document |
| PrdFolderItem | `$(folder)` / `$(folder-opened)` | Folder icon |
| PrdFileItem (Ready) | `$(circle-filled)` | Solid circle — green tint via `ThemeColor` |
| PrdFileItem (In Progress) | `$(sync~spin)` | Spinning sync icon |
| PrdFileItem (Done/Merged) | `$(check)` | Checkmark |
| PrdFileItem (Blocked) | `$(warning)` | Warning triangle |
| PrdFileItem (unknown status) | `$(file)` | Plain file |
| ErrorItem | `$(error)` | Red X circle |
| RefreshButton | `$(refresh)` | Circular arrows |

Status-to-icon mapping is applied in `PrdFileItem` constructor based on the extracted frontmatter status string (case-insensitive):

| Status string | Icon |
|--------------|------|
| `ready`, `queued` | `$(circle-filled)` |
| `in progress`, `in_progress` | `$(sync~spin)` |
| `done`, `merged`, `complete`, `completed` | `$(check)` |
| `blocked` | `$(warning)` |
| anything else / not found | `$(file)` |

### Layout & Spacing

VS Code manages all tree layout — the extension does not control padding, row height, or indentation depth. Designers must work within VS Code's tree view constraints:

- **Indentation**: ~8px per nesting level (VS Code default; not configurable by extension)
- **Row height**: ~22px (VS Code default)
- **Icon size**: 16×16 px (Codicons are already sized correctly)
- **Description**: rendered as secondary text to the right of the label in a lighter color
- **Tooltip**: rendered as a hover card; supports markdown via `vscode.MarkdownString`

Use `vscode.MarkdownString` for tooltips on `ManifestItem` and `PrdFileItem` to allow multi-line, bold, and code-formatted content:

```typescript
// ManifestItem tooltip example
const tip = new vscode.MarkdownString();
tip.appendMarkdown(`**${manifest.name}**\n\n`);
tip.appendMarkdown(`${manifest.description}\n\n`);
tip.appendCodeblock(fsPath, 'text');
item.tooltip = tip;
```

---

## States

### Empty State

When no `manifests/*.json` files exist in the workspace, VS Code displays the `emptyViewText` set on the `TreeView`:

```typescript
vscode.window.createTreeView('wispExplorer', {
  treeDataProvider: provider,
  showCollapseAll: true,
  // emptyViewText is not a direct API option — use a single placeholder item instead
})
```

Since VS Code's `createTreeView` does not expose `emptyViewText` directly on the options object (it is set via `TreeView.message`), the empty state is handled by:

1. Setting `treeView.message` when `getChildren(SectionItem("Manifests"))` returns `[]`
2. Message text: `"No manifests found. Create a manifest in manifests/*.json to get started."`
3. Clearing `treeView.message` when manifests exist

Alternatively, return a single placeholder `WispTreeItem` with label `"No manifests found in workspace"` and no icon — VS Code shows it inline.

**Recommended approach**: Use `treeView.message` (the `TreeView` message property) set in `provider.refresh()` based on whether manifests were found.

### Loading State

VS Code does not provide a built-in loading spinner for tree nodes. The loading experience is:

- Tree nodes are blank (no children) until `getChildren()` resolves the async Promise
- VS Code shows a built-in loading indicator in the view header automatically while `getChildren()` is pending
- No explicit skeleton UI needed; the async loading is imperceptible for < 20 manifests

For the initial expand of a section with many items, the tree shows existing root nodes immediately, then fills in children when the Promise resolves. No additional loading UI is required.

### Error States

| Scenario | Visual treatment |
|----------|-----------------|
| Malformed manifest JSON | `ErrorItem` child under the affected manifest section entry; label: `"⚠ Invalid JSON: <filename>"` |
| File read error (permissions, etc.) | `ErrorItem` with label `"⚠ Cannot read: <filename>"`; tooltip includes the OS error message |
| No workspace open | View shows `treeView.message`: `"Open a folder containing wisp manifests to get started."` |
| PRD file unreadable | `PrdFileItem` renders without title/status; tooltip: `"Could not read file"` |

Error nodes are non-interactive — no command is bound, context menu is suppressed via `contextValue: "wispError"` (no `when` clause matches it).

### Edge Cases

| Case | Handling |
|------|---------|
| Manifest with no `epics`/`orders` key | `EpicItem[]` is empty; expanding shows nothing (VS Code hides expand arrow for empty children) |
| Epic with no `subtasks`/`prds` key | Same — empty children |
| Very long manifest name | `label` is truncated by VS Code with ellipsis; full name in `tooltip` |
| Very long PRD path | `description` shows repo hostname only; full path in `tooltip` |
| PRD file with no `# Heading` | `PrdFileItem.label` falls back to filename; tooltip omits title line |
| Same PRD in multiple epics | Both `SubtaskItem` nodes exist independently — no deduplication |
| Workspace root has no `manifests/` dir | `findFiles('**/manifests/*.json')` returns `[]`; empty state message shown |
| Nested `prds/` directories > 2 levels deep | Only immediate subdirectory used for grouping; deeper paths are collapsed into the immediate parent folder |

---

## Accessibility

### Keyboard Navigation

VS Code handles all tree keyboard navigation natively:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus between nodes |
| `→` | Expand node (or move into children) |
| `←` | Collapse node (or move to parent) |
| `Enter` / `Space` | Activate default command on focused node |
| `F2` | Rename (not applicable — no rename command registered) |
| `Shift+F10` | Open context menu for focused node |

The `Enter` / `Space` activation triggers the `command` property on `PrdFileItem` (opens the file). Other nodes have no default command, so activation is a no-op (VS Code expands/collapses them instead).

### ARIA Labels and Roles

VS Code's `TreeView` API sets the correct `role="tree"` and `role="treeitem"` ARIA attributes automatically. Extensions cannot override these.

Extension responsibilities:
- **`label`**: Primary accessible name — must be human-readable (no icon characters, no IDs)
- **`description`**: Appended to the accessible name by VS Code's accessibility layer
- **`tooltip`**: Available on hover; also read by some screen readers as `aria-description`

Ensure `label` values are always meaningful plain text:
- `ManifestItem.label = manifest.name || stemFromPath` — never the raw file URI
- `PrdFileItem.label = basename(fsPath)` — filename, not URI
- `ErrorItem.label = "Invalid JSON: wisp-extension.json"` — includes filename for context

### Color Contrast

- All icons use `ThemeIcon` which inherits VS Code's foreground color — meets WCAG AA automatically in VS Code's built-in themes
- Status icons for `PrdFileItem` use only shape (icon glyph), not color alone, to distinguish states — safe for color-blind users
- No custom CSS or color overrides are applied

### Screen Reader Announcements

When the tree refreshes (via file watcher or refresh button), VS Code announces the change automatically. No additional `aria-live` regions are needed.

For terminal command output triggered by context menu actions (orchestrate/pipeline), the existing `runWithOutput` pattern in `commands/orchestrate.ts` opens a VS Code output channel — this is automatically accessible.

---

## Context Menu Design

Context menus appear on right-click. Items appear **inline** (in the tree row, not in a submenu) for the primary action per PRD spec.

### Manifest node right-click
```
▶ Run Orchestrate         [inline — primary action]
  Open File
```

### Epic node right-click
```
▶ Run Orchestrate (this epic only)   [inline]
```

### Subtask node right-click
```
▶ Run Pipeline            [inline]
```

### PRD file node right-click
```
  Open File
```

`"inline"` group means the action also appears as a hover icon in the tree row itself (VS Code renders `group: "inline"` actions as icons on hover). This gives one-click access to the most common action without requiring a right-click.
