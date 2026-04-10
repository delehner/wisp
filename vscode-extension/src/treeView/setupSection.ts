import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { WispCli } from '../wispCli';

const AUTH_KEYS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
] as const;

export type SetupStep = 'installCli' | 'installAgents' | 'configureEnv';
export type SetupUtility = 'generatePrd' | 'installSkills';

const CONTEXT_VALUES = {
  installCli: 'wispSetupInstallCli',
  installAgents: 'wispSetupInstallAgents',
  configureEnv: 'wispSetupConfigureEnv',
  generatePrd: 'wispSetupGeneratePrd',
  installSkills: 'wispSetupInstallSkills',
} as const;

const TOOLTIPS: Record<SetupStep | SetupUtility, string> = {
  installCli: 'Install the Wisp CLI via Homebrew',
  installAgents: 'Download agent prompt files (~/.wisp/.ai/agents/)',
  configureEnv: 'Configure API keys and pipeline settings in .env',
  generatePrd: 'Generate PRD files from a manifest',
  installSkills: 'Install skills to .ai/skills/ with IDE symlinks',
};

export class SetupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: SetupStep | SetupUtility,
    label: string,
    command: vscode.Command,
    isComplete?: boolean,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = CONTEXT_VALUES[kind];
    this.command = command;
    this.tooltip = isComplete === true
      ? `${TOOLTIPS[kind]} (complete)`
      : isComplete === false
        ? `${TOOLTIPS[kind]} (pending)`
        : TOOLTIPS[kind];

    if (isComplete === true) {
      this.iconPath = new vscode.ThemeIcon(
        'pass-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
      this.accessibilityInformation = { label: `${label}: complete` };
    } else if (isComplete === false) {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.accessibilityInformation = { label: `${label}: pending` };
    } else if (kind === 'generatePrd') {
      this.iconPath = new vscode.ThemeIcon('add');
    } else {
      this.iconPath = new vscode.ThemeIcon('gear');
    }
  }
}

export async function isCliInstalled(): Promise<boolean> {
  try {
    const found = await WispCli.findOnPath();
    return found !== null;
  } catch {
    return false;
  }
}

export async function areAgentsInstalled(): Promise<boolean> {
  try {
    const agentsDir = vscode.Uri.file(
      path.join(os.homedir(), '.wisp', '.ai', 'agents'),
    );
    await vscode.workspace.fs.stat(agentsDir);
    const entries = await vscode.workspace.fs.readDirectory(agentsDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function isEnvConfigured(
  workspaceRoot: vscode.Uri,
): Promise<boolean> {
  try {
    const envUri = vscode.Uri.joinPath(workspaceRoot, '.env');
    const bytes = await vscode.workspace.fs.readFile(envUri);
    const text = Buffer.from(bytes).toString('utf8');
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
      if ((AUTH_KEYS as readonly string[]).includes(key) && value !== '') {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function buildSetupChildren(
  workspaceRoot?: vscode.Uri,
): Promise<SetupTreeItem[]> {
  const [cliDone, agentsDone, envDone] = await Promise.all([
    isCliInstalled(),
    areAgentsInstalled(),
    workspaceRoot
      ? isEnvConfigured(workspaceRoot)
      : Promise.resolve(false),
  ]);

  return [
    new SetupTreeItem(
      'installCli',
      'Install CLI',
      { command: 'wisp.installCli', title: 'Install CLI' },
      cliDone,
    ),
    new SetupTreeItem(
      'installAgents',
      'Download Agents',
      { command: 'wisp.installAgents', title: 'Download Agents' },
      agentsDone,
    ),
    new SetupTreeItem(
      'configureEnv',
      'Configure .env',
      { command: 'wisp.setupEnv', title: 'Configure .env' },
      envDone,
    ),
    new SetupTreeItem(
      'generatePrd',
      'Generate PRDs',
      { command: 'wisp.generatePrd', title: 'Generate PRDs' },
    ),
    new SetupTreeItem(
      'installSkills',
      'Install Skills',
      { command: 'wisp.installSkills', title: 'Install Skills' },
    ),
  ];
}
