## Summary

Adds a WebView-based Agent Chat panel to the Wisp VSCode extension. The panel streams live agent output as a conversational UI while a pipeline is running, shows per-agent progress in a timeline sidebar, and lets users send interactive control signals (skip/continue/abort) without leaving the editor.

## Changes

- **`vscode-extension/src/panels/chatPanel.ts`**: Singleton WebView controller. Parses JSONL stdout from `WispCli.run()` into structured `ExtensionMessage` events before forwarding to the WebView (tool_use, tool_result, content_block_delta, text, content, and stderr). Generates nonce-based CSP HTML with full embedded CSS (grid layout, agent timeline, chat bubbles, controls bar, summary card). Fires `onUserAction` events from WebView messages for interactive pipeline control.

- **`vscode-extension/src/types/messages.ts`**: Discriminated union message protocol shared between extension and WebView. Defines `ExtensionMessage` (extension → WebView) and `WebviewMessage` (WebView → extension) with all payload shapes.

- **`vscode-extension/media/chat.ts`**: WebView-side vanilla TypeScript (compiled to IIFE). Handles all DOM rendering: agent timeline with status icons and animated spinner, chat bubbles with 100ms batching, collapsible tool call blocks, summary card, DOM node capping at 10,000 with pruning, auto-scroll with user-scroll detection, responsive narrow layout, and ARIA live regions.

- **`vscode-extension/src/wispCli.ts`**: Added `write(data: string)` method for stdin injection (interactive mode signals), and `runCapture()` for full stdout/stderr collection.

- **`vscode-extension/src/commands.ts`**: Wired ChatPanel into all five pipeline commands (orchestrate, pipeline, run, generateContext, monitor). Panel auto-opens on any pipeline command. User action subscriptions forward skip/continue/abort events to `WispCli.write()`.

- **`vscode-extension/src/extension.ts`**: Registered `wisp.openChatPanel` command.

- **`vscode-extension/esbuild.js`**: Added second esbuild context for the WebView bundle (`media/chat.ts` → `media/chat.js`, platform: browser, format: iife, minified). Both contexts run in parallel via `Promise.all`.

- **`vscode-extension/.gitignore`**: Added `media/chat.js` as a build artifact.

## Architecture Decisions

- **JSONL parsed in the TypeScript layer (not the WebView)**: `ChatPanel.handleStdout()` maps raw JSONL to structured `ExtensionMessage` values before `postMessage`. This keeps WebView logic simple and makes the parsing testable with standard Jest mocks.
- **Singleton panel via `ChatPanel.currentPanel`**: `createOrShow()` reveals an existing panel rather than creating duplicates. One pipeline → one panel instance.
- **`retainContextWhenHidden: true`**: Preserves WebView state when the user switches tabs. Trade-off (additional memory) is documented in a code comment.
- **DOM node cap at 10,000**: Oldest stream nodes are pruned with a "— older messages clipped —" notice to prevent memory growth on long pipelines. Full output is always available in the OutputChannel.
- **Two-bundle esbuild**: Extension bundle (CommonJS, Node, external: vscode) and WebView bundle (IIFE, browser, no externals) are built in parallel. The split is required because the WebView cannot import the `vscode` module.

## Testing

- Unit tests: 22 new tests added across `chatPanel.test.ts`, `wispCli.test.ts`, and `commands.test.ts`
- Integration tests: N/A (WebView integration tested manually via the extension)
- Coverage (final): 93.89% statements, 83.95% branches, 93.57% functions, 97.36% lines across all files
- All 219 tests pass

## Screenshots / Recordings

The panel renders a two-column layout: a narrow left column (20%) shows the agent timeline with status icons (pending/running/completed/failed/skipped), and the right column (80%) streams agent output as chat bubbles. Tool calls appear as collapsible `<details>` blocks. Interactive controls (Skip Agent / Continue / Abort Pipeline) animate in at the bottom when the pipeline pauses in `WISP_INTERACTIVE=true` mode.

## Checklist

- [x] Tests pass (219/219)
- [x] Build succeeds (`node esbuild.js` → `[build] build finished`)
- [x] No linter errors (`eslint src/ --max-warnings=0`)
- [x] Architecture doc reviewed
- [x] Design spec followed (VS Code theme tokens, two-column grid, tool call collapsibles)
- [x] Accessibility verified (ARIA live regions, keyboard navigation, sr-only announce element)
- [x] Security considerations addressed (no XSS: all agent output via textContent; nonce-based CSP; minimal localResourceRoots)

## Review Notes

- `commands.ts` branch coverage is 64% — the uncovered branches are the action subscription callbacks inside `orchestrate/pipeline/run/generateContext/monitor` which require a real `ChatPanel` instance (i.e., `createWebviewPanel` to return a non-mock). These are integration-level paths; the tester documented this as a non-blocking recommendation in `test-report.md`.
- The `prUrl` in the summary card is set via `link.href` (DOM property), not string interpolation, so it is safe even if the URL is unexpected.
- `unsafe-inline` in the WebView CSP `style-src` is intentional: VS Code WebViews load theme CSS via inline styles, and CSS injection poses far lower risk than JS injection (which is nonce-gated).
