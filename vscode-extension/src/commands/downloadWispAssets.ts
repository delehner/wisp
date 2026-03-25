import * as vscode from 'vscode';
import AdmZip from 'adm-zip';

/** Default branch archive for delehner/wisp (matches extension repository). */
export const WISP_REPO_ZIP_URL = 'https://github.com/delehner/wisp/archive/refs/heads/main.zip';

export const WISP_ASSET_GITIGNORE_LINES = ['.devcontainer/', 'templates/', 'agents/'] as const;

/** Discover `wisp-main/` (or equivalent) prefix inside a GitHub archive zip. */
export function findZipRootFromEntryNames(entryNames: string[]): string {
  const marker = entryNames.find(
    (n) => n.includes('/.devcontainer/') || /\/\.devcontainer\//.test(n),
  );
  if (marker) {
    const idx = marker.indexOf('/.devcontainer');
    if (idx >= 0) {
      return marker.slice(0, idx + 1);
    }
  }
  const firstFile = entryNames.find((n) => n.length > 0 && !n.endsWith('/'));
  if (!firstFile) {
    throw new Error('Zip archive appears empty.');
  }
  const slash = firstFile.indexOf('/');
  if (slash < 0) {
    throw new Error('Unexpected zip layout (no top-level folder).');
  }
  return firstFile.slice(0, slash + 1);
}

/** Map zip entry to workspace-relative path under `.devcontainer`, `templates`, or `agents`. */
export function relativePathIfWispAsset(zipRoot: string, entryName: string): string | undefined {
  if (!entryName.startsWith(zipRoot)) {
    return undefined;
  }
  const rel = entryName.slice(zipRoot.length);
  const trimmed = rel.replace(/\/$/, '');
  if (!trimmed) {
    return undefined;
  }
  const first = trimmed.split('/')[0];
  if (first !== '.devcontainer' && first !== 'templates' && first !== 'agents') {
    return undefined;
  }
  return rel.endsWith('/') ? `${trimmed}/` : trimmed;
}

/** Returns text to append to `.gitignore`, or null if nothing to add. */
export function buildGitignoreAppend(existingContent: string, lines: readonly string[]): string | null {
  const existingLines = new Set(
    existingContent.split(/\r?\n/).map((l) => l.trimEnd()),
  );
  const toAdd = lines.filter((l) => !existingLines.has(l));
  if (toAdd.length === 0) {
    return null;
  }
  const needsLeadingNewline =
    existingContent.length > 0 && !existingContent.endsWith('\n');
  const prefix = needsLeadingNewline ? '\n' : '';
  const header =
    '\n# Wisp AI — upstream assets (github.com/delehner/wisp; Download Wisp assets command)\n';
  return prefix + header + toAdd.join('\n') + '\n';
}

async function mkdirpUnderRoot(root: vscode.Uri, relativeDir: string): Promise<void> {
  const parts = relativeDir.replace(/\/$/, '').split('/').filter(Boolean);
  let cur = root;
  for (const p of parts) {
    cur = vscode.Uri.joinPath(cur, p);
    try {
      await vscode.workspace.fs.createDirectory(cur);
    } catch {
      /* directory may already exist */
    }
  }
}

async function writeFileUnderRoot(root: vscode.Uri, relativePath: string, data: Uint8Array): Promise<void> {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  await mkdirpUnderRoot(root, parts.slice(0, -1).join('/'));
  const uri = vscode.Uri.joinPath(root, ...parts);
  await vscode.workspace.fs.writeFile(uri, data);
}

async function ensureGitignoreRules(workspaceRoot: vscode.Uri): Promise<void> {
  const gitignoreUri = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
  let text = '';
  try {
    const raw = await vscode.workspace.fs.readFile(gitignoreUri);
    text = new TextDecoder('utf-8').decode(raw);
  } catch {
    /* no .gitignore yet */
  }
  const append = buildGitignoreAppend(text, WISP_ASSET_GITIGNORE_LINES);
  if (append === null) {
    return;
  }
  const next = text + append;
  await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(next));
}

async function fetchZipBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function downloadWispAssetsToWorkspace(workspaceRoot: vscode.Uri): Promise<void> {
  const zipBuffer = await fetchZipBuffer(WISP_REPO_ZIP_URL);
  const zip = new AdmZip(zipBuffer);
  const names = zip
    .getEntries()
    .map((e) => e.entryName.replace(/\\/g, '/'));
  const zipRoot = findZipRootFromEntryNames(names);
  let wrote = 0;
  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    const rel = relativePathIfWispAsset(zipRoot, entryName);
    if (rel === undefined) {
      continue;
    }
    const isDir = entry.isDirectory || entryName.endsWith('/');
    if (isDir) {
      await mkdirpUnderRoot(workspaceRoot, rel);
      continue;
    }
    const data = entry.getData();
    await writeFileUnderRoot(workspaceRoot, rel, new Uint8Array(data));
    wrote += 1;
  }
  if (wrote === 0) {
    throw new Error('No files were extracted (.devcontainer, templates, agents missing in archive?).');
  }
  await ensureGitignoreRules(workspaceRoot);
}

export function registerDownloadWispAssetsCommands(context: vscode.ExtensionContext): void {
  const run = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) {
      void vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Download `.devcontainer`, `templates`, and `agents` from github.com/delehner/wisp into the workspace root? Existing files in those folders may be overwritten.',
      { modal: true },
      'Download',
    );
    if (choice !== 'Download') {
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Wisp AI: Downloading assets…',
          cancellable: false,
        },
        async () => {
          await downloadWispAssetsToWorkspace(folder);
        },
      );
      void vscode.window.showInformationMessage(
        'Wisp AI: Downloaded `.devcontainer`, `templates`, and `agents`. `.gitignore` updated to ignore them.',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Wisp AI: Download failed — ${msg}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.downloadWispAssets', run),
    vscode.commands.registerCommand('wisp.explorer.downloadWispAssets', run),
  );
}
