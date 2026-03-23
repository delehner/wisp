# Installing the Wisp VS Code Extension

## Prerequisites

Before installing the extension, ensure you have:

- **VS Code 1.85 or later** — the extension targets the `^1.85.0` engine
- **wisp CLI installed and on PATH** — the extension is a launcher; it requires the `wisp` binary to be available. See [Prerequisites](prerequisites.md) for install options.

## Installation Methods

### Method 1: VS Code Marketplace (Recommended)

1. Open VS Code.
2. Open the Extensions view: `Cmd+Shift+P` / `Ctrl+Shift+P` → **Extensions: Install Extensions**, or click the Extensions icon in the Activity Bar.
3. Search for **Wisp**.
4. Click **Install** on the Wisp extension by `delehner`.

The extension activates automatically once installed.

### Method 2: Install from VSIX

Use this method to install a specific version downloaded from GitHub Releases, or to sideload a build that has not yet been published to the Marketplace.

1. Download the `.vsix` file from [GitHub Releases](https://github.com/delehner/wisp/releases) — look for assets named `wisp-X.Y.Z.vsix`.
2. Open VS Code.
3. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
4. Run **Extensions: Install from VSIX...**.
5. Select the downloaded `.vsix` file.

### Method 3: Build from Source

Use this method to run the latest unreleased code or a development branch.

**Requirements:** Node.js 20+

```bash
# Clone the repo (or use an existing checkout)
git clone https://github.com/delehner/wisp.git
cd wisp/vscode-extension

# Install dependencies and compile
npm ci
npm run compile

# Package to a .vsix file
npm run package
```

This produces a `wisp-X.Y.Z.vsix` file in `vscode-extension/`. Install it using Method 2 above.

## Verification

After installing the extension, verify it is working:

1. Open a folder that contains a `manifests/` or `prds/` directory (or any wisp workspace).
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
3. Run **Wisp: Show Version**.

You should see the wisp CLI version string in the output panel. If the command succeeds, the extension is correctly finding your `wisp` binary and is ready to use.

## Troubleshooting

### Binary not found (`wisp: command not found`)

The extension could not locate the `wisp` binary on your system `PATH`.

**Option A — Add wisp to PATH:**
Install `wisp` using one of the methods in [Prerequisites](prerequisites.md#installing-the-wisp-cli) and ensure the install location is on your `PATH`. Restart VS Code after updating `PATH`.

**Option B — Set `wisp.binaryPath`:**
Open VS Code User Settings (`Cmd+,` / `Ctrl+,`), search for `wisp.binaryPath`, and enter the absolute path to your `wisp` binary.

```jsonc
// settings.json
{
  "wisp.binaryPath": "/usr/local/bin/wisp"
}
```

> Note: `wisp.binaryPath` must be set in User or Machine settings — workspace settings are ignored for this setting to prevent binary hijacking.

### Extension not activating

**Symptom:** Wisp commands do not appear in the Command Palette, or the extension shows as inactive.

**Checks:**
- Ensure the extension is installed and enabled: open the Extensions view and confirm Wisp shows as enabled.
- The extension activates when the workspace contains `manifests/*.json` or `prds/**/*.md` files, or when any `wisp.*` command is explicitly invoked. Open a wisp project folder to trigger automatic activation.
- Check the VS Code Output panel (View → Output → select "Wisp" from the dropdown) for activation errors.

### Wrong version shown

If **Wisp: Show Version** shows an older version than expected, `wisp.binaryPath` may be pointing to a stale binary. Clear the setting to use `PATH`, or update `wisp.binaryPath` to the correct binary location.
