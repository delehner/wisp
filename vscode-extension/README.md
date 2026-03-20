# Wisp VS Code extension

## Prerequisites

- Node.js 20+ (for `npm ci` / tooling)
- A built **`wisp` binary** on your `PATH`, or configure **`wisp.binaryPath`** in VS Code settings after install

## Build and test (before GitHub / PR)

From the **repository root** (Rust CLI):

```bash
cargo build --release
cargo test
cargo clippy
```

From **`vscode-extension/`**:

```bash
npm ci
npm run compile
npm test
npm run lint
```

CI runs the same checks (see `.github/workflows/ci.yml`).

## Try it in the editor

1. Open the **`vscode-extension`** folder in VS Code or Cursor (File → Open Folder).
2. Run **Run → Start Debugging** (F5) to launch an **Extension Development Host** with this extension loaded.
3. In that window, run **Wisp: Show Version** from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

Ensure the `wisp` binary is on `PATH` in the host, or set **Wisp: Binary Path** (`wisp.binaryPath`) in User Settings.

## Package a `.vsix` (local install, no Marketplace)

```bash
cd vscode-extension
npm run package
```

Install the generated `wisp-0.1.0.vsix` via **Extensions → … → Install from VSIX…**.

## Scripts

| Script      | Action                          |
|------------|----------------------------------|
| `compile`  | esbuild bundle → `out/extension.js` |
| `watch`    | Rebuild on file changes          |
| `test`     | Jest unit tests (mocked `vscode`) |
| `lint`     | ESLint on `src/**/*.ts`          |
| `package`  | `vsce package` → `.vsix`         |
