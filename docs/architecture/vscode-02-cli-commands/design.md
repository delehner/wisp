# Design: VSCode Extension — CLI Commands Integration

## UX Flows

### wisp.orchestrate — Orchestrate Manifest

1. User invokes via Command Palette ("Wisp: Orchestrate Manifest") **or** clicks inline Run icon on a manifest tree item **or** right-clicks a `manifests/**/*.json` file in Explorer → "Wisp: Orchestrate Manifest"
2. **If invoked without a URI**: QuickPick appears titled "Select manifest file" showing relative paths of all `manifests/**/*.json` files in the workspace. If none found, show error: "No manifest files found in workspace."
3. **If invoked with a URI** (tree view / context menu): skip QuickPick; use URI directly.
4. Progress notification appears: "$(sync~spin) Wisp: Orchestrating…" (cancellable). Output channel "Wisp" is revealed and begins streaming.
5. On success: information notification "Wisp: Orchestration complete." Output channel remains open.
6. On cancel: information notification "Wisp: Cancelled."
7. On error: error notification "Wisp: Orchestration failed — see Output for details."

### wisp.pipeline — Run Pipeline

1. User invokes via Command Palette ("Wisp: Run Pipeline") or right-clicks a `prds/**/*.md` file → "Wisp: Run Pipeline".
2. **If invoked without a URI**: InputBox "Enter PRD file path" with placeholder `prds/my-feature.md`. Escape cancels.
3. InputBox "Enter repository URL" with placeholder `https://github.com/org/repo`. Escape cancels.
4. Progress notification: "$(sync~spin) Wisp: Running pipeline…" (cancellable). Output channel revealed.
5. Same success/cancel/error notifications as `orchestrate`.

### wisp.run — Run Agent

1. User invokes via Command Palette ("Wisp: Run Agent").
2. QuickPick titled "Select agent" listing all 14 pipeline agents in order:
   `architect, designer, migration, developer, accessibility, tester, performance, secops, dependency, infrastructure, devops, rollback, documentation, reviewer`
3. InputBox "Enter working directory" with placeholder equal to the workspace root path (or empty if no workspace).
4. InputBox "Enter PRD file path" with placeholder `prds/my-feature.md`.
5. Progress notification: "$(sync~spin) Wisp: Running agent <name>…" (cancellable). Output channel revealed.
6. Same success/cancel/error flow.

### wisp.generatePrd — Generate PRD

1. User invokes via Command Palette ("Wisp: Generate PRD").
2. InputBox "Describe the feature" with placeholder `A user authentication system with OAuth support`. Multi-line not supported; user enters a concise description. Escape cancels.
3. Progress notification: "$(sync~spin) Wisp: Generating PRD…" (non-cancellable — generation is fast). No output channel shown during generation.
4. On success: generated PRD content is opened in a new untitled editor tab with language mode set to Markdown. User can save it manually.
5. On error: error notification "Wisp: PRD generation failed — see Output for details."

### wisp.generateContext — Generate Context

1. User invokes via Command Palette ("Wisp: Generate Context").
2. InputBox "Enter repository URL" with placeholder `https://github.com/org/repo`. Escape cancels.
3. Progress notification: "$(sync~spin) Wisp: Generating context…" (cancellable). Output channel revealed.
4. On success: information notification "Wisp: Context written to contexts/."
5. On error: error notification with details.

### wisp.monitor — Monitor Logs

1. User invokes via Command Palette ("Wisp: Monitor Logs").
2. InputBox "Enter working directory to monitor" pre-filled with workspace root (or empty). Escape cancels.
3. Output channel "Wisp" is revealed. Progress notification: "$(sync~spin) Wisp: Monitoring logs…" (cancellable). Logs stream until user cancels.
4. On cancel: process terminated; information notification "Wisp: Monitoring stopped."

### wisp.installSkills — Install Skills

1. User invokes via Command Palette ("Wisp: Install Skills"). No inputs required.
2. Brief progress notification: "$(sync~spin) Wisp: Installing skills…" (non-cancellable — fast operation).
3. On success: information notification "Wisp: Skills installed successfully."
4. On error: error notification with details.

### Binary Not Found (all commands)

- If `WispCli.resolve()` returns null: show error notification "Wisp binary not found. Set `wisp.binaryPath` in settings or ensure `wisp` is on your PATH." No progress notification is shown.

---

## Component Hierarchy

```
ExtensionContext
├── OutputChannel ("Wisp")                   ← single shared channel
├── WispStatusBar                            ← status bar item (bottom left)
├── CommandHandlers                          ← all 7 command implementations
│   └── uses: WispCli (via cliFactory)
│   └── uses: OutputChannel
├── ManifestTreeDataProvider                 ← Wisp sidebar: Manifests view
│   ├── WispTreeItem (section header)        ← "Manifests" root (collapsed)
│   └── WispTreeItem[] (manifest files)      ← one per *.json in manifests/
└── PrdTreeDataProvider                      ← Wisp sidebar: PRDs view
    ├── WispTreeItem (section header)        ← "PRDs" root (collapsed)
    └── WispTreeItem[] (prd files)           ← one per *.md in prds/
```

---

## Component Specifications

### WispTreeItem

- **Purpose**: Shared tree node for both manifest and PRD providers.
- **Props**: `label: string`, `collapsibleState: TreeItemCollapsibleState`, `resourceUri?: Uri`, `command?: Command`, `contextValue?: string`, `iconPath?: ThemeIcon`
- **Variants**:
  - Section header: `collapsibleState = Collapsed`, no command, no icon
  - Manifest file: `iconPath = $(file-code)`, `contextValue = 'manifestFile'`, `command = wisp.orchestrate(uri)`
  - PRD file: `iconPath = $(book)`, `contextValue = 'prdFile'`, `command = vscode.open(uri)`
  - Empty state: `collapsibleState = None`, label = "No manifests found" / "No PRDs found", `tooltip` explaining where to add files

### ManifestTreeDataProvider

- **Purpose**: Populates the "Manifests" tree view. Watches `**/manifests/**/*.json`.
- **getChildren(undefined)**: Returns a single section-header item "Manifests" (`Collapsed`).
- **getChildren(header)**: Returns one `WispTreeItem` per file found via `vscode.workspace.findFiles('**/manifests/**/*.json')`. Files sorted by path alphabetically. Returns empty-state item if none found.
- **Inline action**: `view/item/context` menu with `group: "inline"` shows `$(play)` run button on manifest file items. Clicking triggers `wisp.orchestrate` with the item's URI.
- **Refresh**: `FileSystemWatcher` on `**/manifests/**/*.json` — fires `_onDidChangeTreeData` on create/delete/change.
- **Dispose**: Disposes the FileSystemWatcher.

### PrdTreeDataProvider

- **Purpose**: Populates the "PRDs" tree view. Watches `**/prds/**/*.md`.
- **getChildren**: Same pattern as ManifestTreeDataProvider using `**/prds/**/*.md`.
- **File item command**: Opens the file in the editor (`vscode.open`). No inline action button.
- **Empty state label**: "No PRDs found in prds/"

### WispStatusBar

- **Position**: `StatusBarAlignment.Left`, priority `100`
- **Found state**: `$(circuit-board) Wisp v1.2.3` — default foreground color
- **Not found state**: `$(warning) Wisp: not found` — `statusBarItem.warningForeground` ThemeColor
- **Command**: `{ command: 'workbench.action.quickOpen', arguments: ['>Wisp '], title: 'Open Wisp commands' }`
- **Tooltip**: "Wisp AI Agent Orchestrator — click to browse commands"
- **Update triggers**: On activation; on `wisp.binaryPath` config change.

### CommandHandlers

- **orchestrate(uri?)**: QuickPick picker items show relative path from workspace root (not absolute). Items sorted alphabetically.
- **run()**: Agent QuickPick items show the agent name with a brief description (e.g., `architect — System design and file structure`). See agent labels below.
- **generatePrd()**: On success, call `vscode.workspace.openTextDocument({ content: output, language: 'markdown' })` then `vscode.window.showTextDocument(doc)`. Output channel not shown during generation.
- **withProgress()**: Always `ProgressLocation.Notification`. Long-running commands (`orchestrate`, `pipeline`, `run`, `monitor`) are `cancellable: true`. Short commands (`generatePrd`, `generateContext`, `installSkills`) are `cancellable: false`.

#### Agent QuickPick Labels

| Value | Label |
|-------|-------|
| `architect` | `architect — System design and file structure` |
| `designer` | `designer — UX flows and component specs` |
| `migration` | `migration — Database schema changes` |
| `developer` | `developer — Feature implementation` |
| `accessibility` | `accessibility — ARIA and keyboard support` |
| `tester` | `tester — Unit and integration tests` |
| `performance` | `performance — Profiling and optimization` |
| `secops` | `secops — Security review` |
| `dependency` | `dependency — Package updates` |
| `infrastructure` | `infrastructure — Cloud and container config` |
| `devops` | `devops — CI/CD pipelines` |
| `rollback` | `rollback — Revert strategy` |
| `documentation` | `documentation — README and docs` |
| `reviewer` | `reviewer — Final code review` |

---

## Visual Specifications

### Icons

All icons use standard VSCode ThemeIcons (no custom icon font required):

| Element | Icon |
|---------|------|
| Activity Bar container | `resources/wisp.svg` (custom SVG — see spec below) |
| Manifest file tree item | `$(file-code)` |
| PRD file tree item | `$(book)` |
| Manifest inline run button | `$(play)` |
| Status bar (found) | `$(circuit-board)` |
| Status bar (not found) | `$(warning)` |
| Progress spinner | `$(sync~spin)` |

### wisp.svg (Activity Bar Icon)

The SVG must be a 16×16 monochrome icon suitable for the VSCode Activity Bar. Use the following simple circuit-board-inspired design (can be overridden with a proper logo later):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">
  <!-- Outer frame -->
  <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/>
  <!-- Circuit nodes -->
  <circle cx="5" cy="5" r="1.2" fill="currentColor"/>
  <circle cx="11" cy="5" r="1.2" fill="currentColor"/>
  <circle cx="5" cy="11" r="1.2" fill="currentColor"/>
  <circle cx="11" cy="11" r="1.2" fill="currentColor"/>
  <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
  <!-- Traces -->
  <line x1="5" y1="5" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
  <line x1="11" y1="5" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
  <line x1="5" y1="11" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
  <line x1="11" y1="11" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
</svg>
```

### Design Tokens

No new design tokens are introduced. The extension uses VSCode's built-in semantic color tokens exclusively:

| Usage | Token |
|-------|-------|
| Status bar warning text | `statusBarItem.warningForeground` |
| Status bar warning background | `statusBarItem.warningBackground` |
| Error notifications | `notificationsErrorIcon.foreground` |
| All other colors | VSCode defaults (inherit from theme) |

### Responsive Behavior

VSCode extensions do not have traditional responsive breakpoints. The Activity Bar sidebar width is user-controlled; tree items must handle variable widths gracefully:

- **Tree item labels**: Truncate with ellipsis if the label overflows. Use `tooltip` set to the full absolute file path so truncated paths remain discoverable.
- **Status bar item**: Text is fixed ("Wisp vX.Y.Z" or "Wisp: not found") and does not truncate.
- **Notifications**: Managed by VSCode; no custom width handling needed.

---

## States

### Loading States

| Component | Loading Behavior |
|-----------|-----------------|
| Tree views (initial) | VSCode shows a native loading spinner while `getChildren()` is async. No custom skeleton needed. |
| Status bar (initial) | Shows "$(circuit-board) Wisp …" (ellipsis) until `update()` resolves. |
| Long-running commands | `vscode.window.withProgress` notification with `$(sync~spin)` prefix in the title. |

### Error States

| Scenario | Behavior |
|----------|----------|
| Binary not found at command invocation | `showErrorMessage`: "Wisp binary not found. Set `wisp.binaryPath` in settings or ensure `wisp` is on your PATH." |
| Command fails (non-zero exit) | `showErrorMessage`: "Wisp: <CommandTitle> failed — see Output for details." Output channel is revealed automatically. |
| No manifest files found (QuickPick) | `showErrorMessage`: "No manifest files found in workspace. Add `*.json` files under a `manifests/` directory." |
| Workspace not open | `showErrorMessage`: "Wisp: No workspace folder is open." (for commands requiring a workspace root). |
| User cancels InputBox mid-flow | Silently abort — no notification. (User pressed Escape intentionally.) |

### Empty States

| View | Empty State Label | Tooltip |
|------|-----------------|---------|
| Manifests tree | "No manifests found in workspace" | "Add *.json files under a manifests/ directory" |
| PRDs tree | "No PRDs found in workspace" | "Add *.md files under a prds/ directory" |

Empty state items have `TreeItemCollapsibleState.None` and no command.

### Edge Cases

| Case | Handling |
|------|----------|
| Very long file paths in tree view | `label` shows filename only; `description` shows parent dir; `tooltip` shows full path |
| >100 manifest/PRD files | `findFiles` returns all matches; tree renders them all (VSCode virtualizes internally). No pagination needed per PRD performance requirement (<500ms). |
| Binary path contains spaces | `WispCli.run()` passes args as array — no shell interpolation. Safe. |
| Workspace with multiple roots | `findFiles` searches all workspace roots. Paths shown relative to the nearest workspace root. |
| Monitor never terminates | User must cancel via the progress notification. Process is SIGTERM'd on cancellation token fire. |

---

## Accessibility

### Keyboard Navigation

| Element | Keyboard Behavior |
|---------|-----------------|
| Activity Bar icon | `Tab` navigates to it; `Enter`/`Space` opens the sidebar |
| Tree view items | Arrow keys navigate; `Enter` triggers the item's command |
| Inline Run button | `Tab` within the tree row reaches the button; `Enter`/`Space` activates |
| QuickPick | Standard VSCode QuickPick: arrow keys to select, `Enter` to confirm, `Escape` to cancel |
| InputBox | Standard text input; `Enter` to confirm, `Escape` to cancel |
| Progress notification | `Escape` or clicking the cancel button triggers cancellation token |

### ARIA Labels and Roles

VSCode handles ARIA for native UI components (QuickPick, InputBox, TreeView, StatusBar, Notifications). No custom ARIA attributes are needed in the extension code because all UI is rendered by VSCode's webview-free native API.

For tree items, ensure `tooltip` is always set to a meaningful description — VSCode exposes this as the accessible label for screen readers when the visual label is truncated.

### Color Contrast

All text/icon contrast is inherited from the active VSCode theme. The only custom color usage is `statusBarItem.warningForeground` / `statusBarItem.warningBackground` for the "not found" state — these are theme-defined tokens that meet VSCode's own contrast requirements.

No hardcoded hex colors are used anywhere.

### Screen Reader Announcements

- Progress notifications are announced by VSCode's accessibility layer automatically.
- `showInformationMessage` / `showErrorMessage` calls are announced as they appear.
- Tree view refresh (`onDidChangeTreeData`) causes the tree to re-render; VSCode announces structural changes to screen readers.
- When `generatePrd` opens a new document, VSCode announces the new editor tab.

### Focus Management

- After a command completes and output channel is revealed, focus remains in the active editor. The output channel is shown but does not steal keyboard focus.
- After `generatePrd` opens a new document, focus moves to the new editor tab (VSCode default behavior for `showTextDocument`).
- After error/info notifications appear, focus is not moved (VSCode default).
