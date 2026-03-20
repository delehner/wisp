import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Parse a .env file content: KEY=VALUE lines, skipping # comments and empty lines */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding single or double quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

/** Convert a .wisp JSON config object to WISP_* env vars */
function wispFileToEnv(obj: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  const mapping: Record<string, string> = {
    provider: 'WISP_PROVIDER',
    maxParallel: 'WISP_MAX_PARALLEL',
    maxIterations: 'WISP_MAX_ITERATIONS',
    baseBranch: 'WISP_BASE_BRANCH',
    workDir: 'WISP_WORK_DIR',
    useDevcontainer: 'WISP_USE_DEVCONTAINER',
    skipPr: 'WISP_SKIP_PR',
    interactive: 'WISP_INTERACTIVE',
    logDir: 'WISP_LOG_DIR',
    verbose: 'WISP_VERBOSE',
    evidenceAgents: 'WISP_EVIDENCE_AGENTS',
    claudeModel: 'WISP_CLAUDE_MODEL',
    geminiModel: 'WISP_GEMINI_MODEL',
  };
  for (const [key, envKey] of Object.entries(mapping)) {
    if (key in obj && obj[key] !== undefined && obj[key] !== '') {
      env[envKey] = String(obj[key]);
    }
  }
  return env;
}

/** Read wisp.* VSCode settings and convert to WISP_* env vars.
 * Only includes settings explicitly configured by the user (workspace/folder/user scope),
 * not schema defaults — preserving the .env → .wisp → VSCode priority chain. */
function vscodeSettingsToEnv(): Record<string, string> {
  const config = vscode.workspace.getConfiguration('wisp');
  const env: Record<string, string> = {};

  /** True if the setting was explicitly set in any scope (not just the schema default) */
  const isExplicit = (key: string): boolean => {
    const info = config.inspect(key);
    return (
      info !== undefined &&
      (info.workspaceFolderValue !== undefined ||
        info.workspaceValue !== undefined ||
        info.globalValue !== undefined)
    );
  };

  const str = (key: string, envKey: string): void => {
    if (!isExplicit(key)) return;
    const v = config.get<string>(key);
    if (v) env[envKey] = v;
  };
  const num = (key: string, envKey: string): void => {
    if (!isExplicit(key)) return;
    const v = config.get<number>(key);
    if (v !== undefined && v !== null) env[envKey] = String(v);
  };
  const bool = (key: string, envKey: string): void => {
    if (!isExplicit(key)) return;
    const v = config.get<boolean>(key);
    if (v !== undefined && v !== null) env[envKey] = String(v);
  };

  str('provider', 'WISP_PROVIDER');
  num('maxParallel', 'WISP_MAX_PARALLEL');
  num('maxIterations', 'WISP_MAX_ITERATIONS');
  str('baseBranch', 'WISP_BASE_BRANCH');
  str('workDir', 'WISP_WORK_DIR');
  bool('useDevcontainer', 'WISP_USE_DEVCONTAINER');
  bool('skipPr', 'WISP_SKIP_PR');
  bool('interactive', 'WISP_INTERACTIVE');
  str('logDir', 'WISP_LOG_DIR');
  bool('verbose', 'WISP_VERBOSE');
  str('evidenceAgents', 'WISP_EVIDENCE_AGENTS');
  str('claudeModel', 'WISP_CLAUDE_MODEL');
  str('geminiModel', 'WISP_GEMINI_MODEL');

  return env;
}

/**
 * Resolve the Wisp root folder in the workspace.
 * Priority: wisp.rootFolder setting → folder containing manifests/ → first folder.
 */
export function resolveWispRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;

  const config = vscode.workspace.getConfiguration('wisp');
  const rootFolderName = config.get<string>('rootFolder') ?? '';
  if (rootFolderName) {
    const match = folders.find((f) => f.name === rootFolderName);
    if (match) return match.uri.fsPath;
  }

  // Prefer folder containing manifests/
  for (const folder of folders) {
    const manifestsDir = path.join(folder.uri.fsPath, 'manifests');
    if (fs.existsSync(manifestsDir)) return folder.uri.fsPath;
  }

  return folders[0].uri.fsPath;
}

/**
 * Resolve effective environment for CLI invocations.
 * Priority (lowest → highest): .env file → .wisp JSON → VSCode settings.
 * Auth tokens (ANTHROPIC_API_KEY, GITHUB_TOKEN, GEMINI_API_KEY) are never
 * read from VSCode settings — only from process env or .env file.
 */
export async function resolveEnv(root: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // .env file
  try {
    const content = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    Object.assign(env, parseEnvFile(content));
  } catch {
    // Missing .env is fine
  }

  // .wisp JSON file
  try {
    const content = fs.readFileSync(path.join(root, '.wisp'), 'utf-8');
    const obj = JSON.parse(content) as Record<string, unknown>;
    Object.assign(env, wispFileToEnv(obj));
  } catch {
    // Missing or malformed .wisp: swallow gracefully
  }

  // VSCode settings (highest priority)
  Object.assign(env, vscodeSettingsToEnv());

  return env;
}
