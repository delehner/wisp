# Wisp VSCode Extension

The Wisp extension brings Wisp pipeline control into VSCode, Cursor, and Antigravity. It locates the `wisp` binary on your machine and provides IDE integration points for triggering pipelines without leaving your editor.

## Requirements

- VSCode ≥ 1.85, Cursor (any recent version), or Antigravity (VSCode-compatible fork)
- `wisp` binary installed on your machine ([installation instructions](https://github.com/delehner/wisp#installation))
- Node.js 20+ (for building from source only)

## Installation

### From VSIX (manual)

1. Download `wisp-<version>.vsix` from [GitHub Releases](https://github.com/delehner/wisp/releases)
2. In VSCode: open the Command Palette → **Extensions: Install from VSIX…**
3. Select the downloaded `.vsix` file

### From Source

```bash
cd vscode-extension
npm ci
npm run compile
npm run package        # produces wisp-<version>.vsix
```

Then install the generated `.vsix` as above.

## Activation

The extension activates automatically when your workspace contains any of:

- A `manifests/` directory with `.json` files
- A `prds/` directory with `.md` files

It also activates on demand when any `wisp.*` command is invoked from the Command Palette.

There is no persistent background process — the extension only runs when one of these conditions is met.

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `wisp.binaryPath` | `string` | `""` | Absolute path to the `wisp` binary. Leave empty to use `PATH`. |

**Note**: `wisp.binaryPath` is a **machine-level setting** — it cannot be overridden by a workspace's `.vscode/settings.json`. This prevents a malicious repository from substituting an arbitrary executable.

### Setting the binary path

If `wisp` is not on your `PATH`, set `wisp.binaryPath` in your user settings (`Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**):

```json
{
  "wisp.binaryPath": "/usr/local/bin/wisp"
}
```

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `wisp.showVersion` | **Wisp: Show Version** | Runs `wisp --version` and shows the version string in an info notification. If the binary is not found, shows an install prompt instead. |

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **Wisp** to see all available commands.

## Binary Resolution

When a command runs, the extension resolves the `wisp` binary in this order:

1. **`wisp.binaryPath` user setting** — if non-empty, used as-is
2. **`PATH` lookup** — runs `which wisp` (macOS/Linux) or `where wisp` (Windows)
3. **Install prompt** — if not found, shows: *"Wisp binary not found. Install it?"* with an **Install** button that opens the installation page in your browser

## Output Channel

A **Wisp** output channel is created when the extension activates. Raw CLI output (stdout/stderr) from future pipeline commands will appear here, prefixed with `[stdout]` and `[stderr]`.

To view it: **View → Output** → select **Wisp** from the dropdown.

## Development

### Project layout

```
vscode-extension/
├── src/
│   ├── extension.ts          # activate() / deactivate() entry point
│   ├── wispCli.ts            # WispCli class — binary resolution + CLI execution
│   └── __tests__/
│       └── wispCli.test.ts   # Unit tests (Jest + ts-jest)
├── esbuild.js                # Bundle script: src/extension.ts → out/extension.js
├── jest.config.js            # Jest config
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
```

### Common tasks

```bash
cd vscode-extension

npm ci                  # install dependencies
npm run compile         # compile once (out/extension.js)
npm run watch           # compile on file changes
npm run lint            # ESLint (zero errors required)
npm test                # run unit tests
npm run package         # build .vsix for distribution
```

### Running in the Extension Development Host

1. Open the `wisp` repository in VSCode
2. Press `F5` (or **Run → Start Debugging**) — not yet configured; add a launch config targeting `vscode-extension/` for interactive debugging
3. A new VSCode window opens with the extension loaded

### Adding tests

Tests live in `src/__tests__/`. The `vscode` module is mocked at `src/__mocks__/vscode.ts`. Tests run with Jest + ts-jest:

```bash
npm test                        # run all tests
npm test -- --watch             # watch mode
npm test -- --verbose           # show individual test names
```

### Bundling notes

`esbuild.js` bundles the extension to a single `out/extension.js`. Key constraints:

- `vscode` is marked **external** (provided by the host at runtime)
- Zero production runtime dependencies (only `node:child_process` and `node:readline` built-ins)
- Resulting bundle is ~4.6 KB — well under the 500 KB limit

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Commands not appearing in palette | Extension not activated | Open a workspace with a `manifests/` folder, or run any `wisp.*` command directly |
| "Wisp binary not found" on every command | `wisp` not in PATH, no `wisp.binaryPath` set | Install `wisp` or set `wisp.binaryPath` in user settings |
| `wisp.binaryPath` setting ignored | Set at workspace level | Move it to user/machine settings — workspace overrides are rejected for security |
| Extension not loading after `.vsix` install | VSCode restart needed | Reload the window (`Ctrl+Shift+P` → **Developer: Reload Window**) |
