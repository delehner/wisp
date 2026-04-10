import * as vscode from 'vscode';
import AdmZip from 'adm-zip';

/** Default branch archive for delehner/wisp (matches extension repository). */
export const WISP_REPO_ZIP_URL = 'https://github.com/delehner/wisp/archive/refs/heads/main.zip';

export const WISP_ASSET_GITIGNORE_LINES = ['.ai/agents/', '.ai/skills/', '.devenv/.devcontainer/', '.devenv/templates/'] as const;

/** IDE-specific directory symlinks mapping to canonical .ai/ locations. */
const IDE_SYMLINK_TARGETS = [
  { ide: '.cursor', subdir: 'agents' },
  { ide: '.cursor', subdir: 'skills' },
  { ide: '.cursor', subdir: 'rules' },
  { ide: '.antigravity', subdir: 'agents' },
  { ide: '.antigravity', subdir: 'skills' },
  { ide: '.antigravity', subdir: 'rules' },
] as const;

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

/**
 * Map zip entry to workspace-relative path under `.ai/` or `.devenv/`.
 *
 * - `agents/...` -> `.ai/agents/...`
 * - `skills/...` -> `.ai/skills/...`
 * - `.devcontainer/agent/...` -> `.devenv/.devcontainer/agent/...`
 * - `templates/...` -> `.devenv/templates/...`
 *
 * Only the agent runner devcontainer is included — the main `.devcontainer/` config
 * (Dockerfile, post-start.sh, init-firewall.sh) is for developing wisp itself and must
 * not be placed into user workspaces.
 */
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
  if (first !== '.devcontainer' && first !== 'templates' && first !== 'agents' && first !== 'skills') {
    return undefined;
  }
  if (first === '.devcontainer') {
    const parts = trimmed.split('/');
    if (parts.length < 2 || parts[1] !== 'agent') {
      return undefined;
    }
    const remapped = `.devenv/${trimmed}`;
    return rel.endsWith('/') ? `${remapped}/` : remapped;
  }
  if (first === 'templates') {
    const remapped = `.devenv/${trimmed}`;
    return rel.endsWith('/') ? `${remapped}/` : remapped;
  }
  if (first === 'agents' || first === 'skills') {
    const remapped = '.ai/' + trimmed;
    return rel.endsWith('/') ? `${remapped}/` : remapped;
  }
  return undefined;
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

/** Subdirectories that contain downloaded (recoverable) assets. */
const DOWNLOADED_AI_SUBDIRS = ['agents', 'skills'] as const;
const DOWNLOADED_DEVENV_SUBDIRS = ['.devcontainer', 'templates'] as const;

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

/** Check if a URI exists as a directory. */
async function dirExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

/**
 * Remove only the downloaded asset subdirs, preserving user content
 * like `.ai/rules/`, `.devenv/prds/`, and `.devenv/manifests/`.
 */
async function cleanDownloadedAssets(workspaceRoot: vscode.Uri): Promise<void> {
  for (const subdir of DOWNLOADED_AI_SUBDIRS) {
    const uri = vscode.Uri.joinPath(workspaceRoot, '.ai', subdir);
    if (await dirExists(uri)) {
      await vscode.workspace.fs.delete(uri, { recursive: true });
    }
  }
  for (const subdir of DOWNLOADED_DEVENV_SUBDIRS) {
    const uri = vscode.Uri.joinPath(workspaceRoot, '.devenv', subdir);
    if (await dirExists(uri)) {
      await vscode.workspace.fs.delete(uri, { recursive: true });
    }
  }
}

/**
 * Create relative symlinks from IDE-specific directories to `.ai/` sub-paths.
 * Covers agents, skills, and rules for each supported IDE.
 * Skips if the target already exists as a non-symlink directory (won't clobber user content).
 */
async function createIdeSymlinks(workspaceRoot: vscode.Uri): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const fsPath = workspaceRoot.fsPath;

  for (const { ide, subdir } of IDE_SYMLINK_TARGETS) {
    const targetPath = `${ide}/${subdir}`;
    const ideDirUri = vscode.Uri.joinPath(workspaceRoot, ide);
    const symlinkUri = vscode.Uri.joinPath(workspaceRoot, targetPath);

    try {
      const stat = await vscode.workspace.fs.stat(symlinkUri);
      if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
        await vscode.workspace.fs.delete(symlinkUri);
      } else if ((stat.type & vscode.FileType.Directory) !== 0) {
        continue;
      }
    } catch {
      // Doesn't exist — we'll create it
    }

    try {
      await vscode.workspace.fs.createDirectory(ideDirUri);
    } catch {
      /* may already exist */
    }

    try {
      await execAsync(
        `ln -snf "../.ai/${subdir}" "${targetPath}"`,
        { cwd: fsPath },
      );
    } catch {
      // Symlink creation may fail on some platforms — non-fatal
    }
  }
}

export async function downloadWispAssetsToWorkspace(workspaceRoot: vscode.Uri): Promise<void> {
  await cleanDownloadedAssets(workspaceRoot);

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
    throw new Error('No files were extracted (.ai/agents missing in archive?).');
  }
  await ensureGitignoreRules(workspaceRoot);
  await createIdeSymlinks(workspaceRoot);
}

export function registerDownloadWispAssetsCommands(context: vscode.ExtensionContext): void {
  const run = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) {
      void vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Download agents, skills, devcontainer, and templates from github.com/delehner/wisp into `.ai/` and `.devenv/`? Existing downloaded assets will be replaced.',
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
        'Wisp AI: Downloaded assets to `.ai/` and `.devenv/`. IDE symlinks created.',
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
