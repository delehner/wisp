import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const ENV_PATH = path.join(os.homedir(), '.wisp', '.env');

interface EnvVar {
  key: string;
  label: string;
  group: string;
  placeholder: string;
  password?: boolean;
  defaultValue?: string;
}

const ENV_VARS: EnvVar[] = [
  // Auth
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', group: 'Auth', placeholder: 'sk-ant-...', password: true },
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth Token', group: 'Auth', placeholder: 'OAuth token (alternative to API key)', password: true },
  { key: 'GEMINI_API_KEY', label: 'Gemini API Key', group: 'Auth', placeholder: 'AI...', password: true },
  { key: 'GOOGLE_API_KEY', label: 'Google API Key', group: 'Auth', placeholder: 'AI... (alternative for Gemini)', password: true },
  { key: 'GITHUB_TOKEN', label: 'GitHub Token', group: 'Auth', placeholder: 'ghp_...', password: true },

  // Provider
  { key: 'AI_PROVIDER', label: 'AI Provider', group: 'Provider', placeholder: 'claude or gemini', defaultValue: 'claude' },
  { key: 'CLAUDE_MODEL', label: 'Claude Model', group: 'Provider', placeholder: 'sonnet', defaultValue: 'sonnet' },
  { key: 'GEMINI_MODEL', label: 'Gemini Model', group: 'Provider', placeholder: 'gemini-2.5-pro', defaultValue: 'gemini-2.5-pro' },
  { key: 'CLAUDE_ALLOWED_TOOLS', label: 'Claude Allowed Tools', group: 'Provider', placeholder: 'Edit,Write,Bash,Read,MultiEdit', defaultValue: 'Edit,Write,Bash,Read,MultiEdit' },

  // Pipeline
  { key: 'PIPELINE_MAX_PARALLEL', label: 'Max Parallel Pipelines', group: 'Pipeline', placeholder: '4', defaultValue: '4' },
  { key: 'PIPELINE_MAX_ITERATIONS', label: 'Max Iterations per Agent', group: 'Pipeline', placeholder: '2', defaultValue: '2' },
  { key: 'DEFAULT_BASE_BRANCH', label: 'Default Base Branch', group: 'Pipeline', placeholder: 'main', defaultValue: 'main' },
  { key: 'PIPELINE_WORK_DIR', label: 'Pipeline Work Directory', group: 'Pipeline', placeholder: '/tmp/coding-agents-work', defaultValue: '/tmp/coding-agents-work' },
  { key: 'USE_DEVCONTAINER', label: 'Use Dev Container', group: 'Pipeline', placeholder: 'true or false', defaultValue: 'true' },
  { key: 'PIPELINE_CLEANUP', label: 'Cleanup After Pipeline', group: 'Pipeline', placeholder: 'true or false', defaultValue: 'false' },
  { key: 'INTERACTIVE', label: 'Interactive Mode', group: 'Pipeline', placeholder: 'true or false', defaultValue: 'false' },

  // Logging
  { key: 'LOG_LEVEL', label: 'Log Level', group: 'Logging', placeholder: 'trace/debug/info/warn/error', defaultValue: 'info' },
  { key: 'LOG_DIR', label: 'Log Directory', group: 'Logging', placeholder: './logs', defaultValue: './logs' },
  { key: 'VERBOSE_LOGS', label: 'Verbose Logs', group: 'Logging', placeholder: 'true or false', defaultValue: 'false' },
];

export function parseEnvFile(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars.set(key, value);
  }
  return vars;
}

export function serializeEnvFile(vars: Map<string, string>): string {
  const groups = new Map<string, string[]>();

  for (const envVar of ENV_VARS) {
    const value = vars.get(envVar.key);
    if (value === undefined || value === '') {
      continue;
    }
    const lines = groups.get(envVar.group) ?? [];
    lines.push(`${envVar.key}=${value}`);
    groups.set(envVar.group, lines);
  }

  // Append any extra keys not in ENV_VARS
  const knownKeys = new Set(ENV_VARS.map((v) => v.key));
  const extraLines: string[] = [];
  for (const [key, value] of vars) {
    if (!knownKeys.has(key) && value !== '') {
      extraLines.push(`${key}=${value}`);
    }
  }

  const sections: string[] = [];
  for (const [group, lines] of groups) {
    sections.push(`# ${group}\n${lines.join('\n')}`);
  }
  if (extraLines.length > 0) {
    sections.push(`# Other\n${extraLines.join('\n')}`);
  }

  return sections.join('\n\n') + '\n';
}

async function readCurrentEnv(): Promise<Map<string, string>> {
  try {
    const uri = vscode.Uri.file(ENV_PATH);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseEnvFile(Buffer.from(bytes).toString('utf8'));
  } catch {
    return new Map();
  }
}

async function writeEnvFile(vars: Map<string, string>): Promise<void> {
  const dir = vscode.Uri.file(path.dirname(ENV_PATH));
  try {
    await vscode.workspace.fs.stat(dir);
  } catch {
    await vscode.workspace.fs.createDirectory(dir);
  }
  const content = serializeEnvFile(vars);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(ENV_PATH),
    Buffer.from(content, 'utf8'),
  );
}

interface EnvQuickPickItem extends vscode.QuickPickItem {
  envKey: string;
  group: string;
  currentValue: string;
  envVar: EnvVar;
}

export function registerConfigureEnvCommand(
  context: vscode.ExtensionContext,
): void {
  const cmd = vscode.commands.registerCommand('wisp.configureEnv', async () => {
    const currentVars = await readCurrentEnv();

    const items: EnvQuickPickItem[] = ENV_VARS.map((v) => {
      const currentValue = currentVars.get(v.key) ?? '';
      const hasValue = currentValue !== '';
      return {
        label: `$(${hasValue ? 'pass-filled' : 'circle-outline'}) ${v.label}`,
        description: v.key,
        detail: hasValue
          ? (v.password ? '••••••••' : currentValue)
          : (v.defaultValue ? `default: ${v.defaultValue}` : 'not set'),
        envKey: v.key,
        group: v.group,
        currentValue,
        envVar: v,
      };
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Configure Wisp Environment (~/.wisp/.env)',
      placeHolder: 'Select a variable to configure',
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      return;
    }

    const newValue = await vscode.window.showInputBox({
      title: `Set ${picked.envVar.label}`,
      prompt: `${picked.envVar.key}`,
      value: picked.currentValue || picked.envVar.defaultValue || '',
      placeHolder: picked.envVar.placeholder,
      password: picked.envVar.password ?? false,
      ignoreFocusOut: true,
    });

    if (newValue === undefined) {
      return;
    }

    currentVars.set(picked.envKey, newValue);
    await writeEnvFile(currentVars);

    const action = await vscode.window.showInformationMessage(
      `Wisp AI: ${picked.envVar.label} updated in ~/.wisp/.env`,
      'Configure Another',
      'Open File',
    );

    if (action === 'Configure Another') {
      await vscode.commands.executeCommand('wisp.configureEnv');
    } else if (action === 'Open File') {
      const doc = await vscode.workspace.openTextDocument(ENV_PATH);
      await vscode.window.showTextDocument(doc);
    }
  });

  context.subscriptions.push(cmd);
}
