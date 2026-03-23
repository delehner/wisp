# Publishing the Wisp VS Code Extension

This guide is for maintainers who need to publish a new version of the Wisp VS Code extension to the VS Code Marketplace and GitHub Releases. Publishing is fully automated via `.github/workflows/publish-vscode.yml` — pushing a version tag is all that is required after the one-time setup.

For the full release runbook including rollback steps, see `docs/architecture/marketplace-publish/devops.md`.

## One-Time Setup

### 1. Create a publisher on Azure DevOps

The VS Code Marketplace uses Azure DevOps for publisher identity.

1. Sign in at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) with your Microsoft account.
2. Click **Create publisher**.
3. Set the publisher ID to `delehner` (must match the `publisher` field in `vscode-extension/package.json`).
4. Fill in the display name and save.

### 2. Generate a VSCE Personal Access Token (PAT)

1. Go to [dev.azure.com](https://dev.azure.com) and sign in.
2. Click your profile icon (top right) → **Personal access tokens**.
3. Click **New Token**.
4. Set the name (e.g., `wisp-vsce-publish`), organization to **All accessible organizations**, and expiration (1 year recommended).
5. Under **Scopes**, select **Custom defined**, then expand **Marketplace** and check **Publish**.
6. Click **Create** and copy the token — you will not see it again.

### 3. Store the PAT as a GitHub secret

1. In the [wisp GitHub repository](https://github.com/delehner/wisp), go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `VSCE_PAT`, Value: the token copied above.
4. Click **Add secret**.

The publish workflow reads `secrets.VSCE_PAT` and will fail if this secret is missing or expired.

### 4. Optional: Open VSX Registry

To also publish to the [Open VSX Registry](https://open-vsx.org) (used by VS Codium and other editors):

1. Create a publisher account at [open-vsx.org](https://open-vsx.org).
2. Generate a token in your Open VSX account settings.
3. Store it as `OVSX_PAT` in GitHub Secrets (same steps as above).

If `OVSX_PAT` is set, the workflow publishes to Open VSX after the Marketplace publish. Open VSX publish failures are non-blocking — a failure there does not prevent the GitHub Release or Marketplace publish from completing.

## Release Process

### Step 1: Bump the version

Edit `vscode-extension/package.json` and update the `version` field:

```jsonc
{
  "version": "0.2.0"   // was "0.1.0"
}
```

Commit and push this change to `main` (or merge it via PR):

```bash
git add vscode-extension/package.json
git commit -m "chore(vscode): bump version to 0.2.0"
git push origin main
```

### Step 2: Push the version tag

The tag version **must match** `package.json` exactly. The workflow validates this and fails before publishing if they differ.

```bash
git tag vscode-v0.2.0
git push origin vscode-v0.2.0
```

### Step 3: Monitor the workflow

1. Go to the [Actions tab](https://github.com/delehner/wisp/actions) in the GitHub repository.
2. Find the **Publish VSCode Extension** workflow run triggered by the tag push.
3. The workflow runs: install → compile → lint → test → validate version → package → publish to Marketplace → upload to GitHub Release → publish to Open VSX (optional).

A green check means the extension is live on the Marketplace. A red failure means one of the steps above failed — click the job to read the error.

### Step 4: Verify the publish

- **VS Code Marketplace:** Search for "Wisp" in the Extensions view of VS Code, or visit [marketplace.visualstudio.com](https://marketplace.visualstudio.com) and search for the extension. The new version should appear within a few minutes of a successful publish.
- **GitHub Releases:** The workflow creates a release named `VSCode Extension vX.Y.Z` with the `.vsix` file attached. Tags containing a hyphen (e.g., `vscode-v0.2.0-beta`) are automatically marked as pre-release.

## PAT Rotation

VSCE PATs expire. Azure DevOps tokens have a maximum lifetime of 1 year. Rotate the `VSCE_PAT` before it expires to avoid a broken publish workflow.

**Annual rotation steps:**

1. Go to [dev.azure.com](https://dev.azure.com) → profile icon → **Personal access tokens**.
2. Find the existing token and click **Renew**, or click **New Token** to create a replacement (same scopes: Marketplace → Publish, all organizations).
3. Copy the new token.
4. In the GitHub repository, go to **Settings → Secrets and variables → Actions → `VSCE_PAT`** → **Update**.
5. Paste the new token and save.

The old token can be revoked after the new one is stored.

The same rotation steps apply to `OVSX_PAT` if Open VSX publishing is enabled.

## Troubleshooting

### PAT expired

**Symptom:** The `Publish to VS Code Marketplace` step fails with an authentication error such as `401 Unauthorized` or `Personal access token is expired`.

**Fix:** Rotate the `VSCE_PAT` secret following the steps above, then re-run the failed workflow.

### Version mismatch

**Symptom:** The `Validate version matches tag` step fails with:

```
Error: tag version (0.2.0) does not match package.json version (0.1.0)
```

**Fix:** Update `vscode-extension/package.json` to match the tag version, commit to `main`, delete the old tag, and push a new tag with the correct version.

```bash
# Delete the incorrect tag locally and remotely
git tag -d vscode-v0.2.0
git push origin :refs/tags/vscode-v0.2.0

# After fixing package.json and pushing to main:
git tag vscode-v0.2.0
git push origin vscode-v0.2.0
```

### Extension not appearing on Marketplace after publish

Marketplace indexing can take a few minutes. If the extension does not appear after 10 minutes, check:

1. The GitHub Actions run completed successfully with no errors.
2. The publisher (`delehner`) matches the `publisher` field in `package.json`.
3. No duplicate version was already published — the Marketplace rejects re-publishing the same version number. Bump the version and publish a new tag.
