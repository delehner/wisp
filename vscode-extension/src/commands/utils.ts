import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';

export const KNOWN_AGENTS = [
  'architect',
  'designer',
  'migration',
  'developer',
  'accessibility',
  'tester',
  'performance',
  'secops',
  'dependency',
  'infrastructure',
  'devops',
  'rollback',
  'documentation',
  'reviewer',
];

export async function pickManifestFile(cwd: string): Promise<string | undefined> {
  const uris = await vscode.workspace.findFiles('**/manifests/*.json');
  if (uris.length > 0) {
    const items = uris.map((u) => u.fsPath);
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a manifest file',
    });
    return picked;
  }
  return vscode.window.showInputBox({
    prompt: 'No manifest files found. Enter path to manifest JSON',
    placeHolder: `${cwd}/manifests/my-manifest.json`,
  });
}

export async function pickPrdFile(cwd: string): Promise<string | undefined> {
  const uris = await vscode.workspace.findFiles('**/prds/**/*.md');
  if (uris.length > 0) {
    const items = uris.map((u) => u.fsPath);
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a PRD file',
    });
    return picked;
  }
  return vscode.window.showInputBox({
    prompt: 'No PRD files found. Enter path to PRD markdown file',
    placeHolder: `${cwd}/prds/my-feature/prd.md`,
  });
}

export async function runWithOutput(
  cli: WispCli,
  args: string[],
  cwd: string,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate?: (cli: WispCli) => void,
  onDone?: () => void,
): Promise<number> {
  if (cli.isRunning) {
    vscode.window.showWarningMessage('A Wisp pipeline is already running.');
    return 1;
  }

  outputChannel.show(true);
  statusBar.setRunning();
  onActivate?.(cli);

  try {
    const code = await cli.run(
      args,
      cwd,
      (line) => outputChannel.appendLine(line),
      (line) => outputChannel.appendLine(`[stderr] ${line}`),
    );
    return code;
  } finally {
    statusBar.setIdle();
    onDone?.();
  }
}

export function registerInstallSkillsCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.installSkills', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    const code = await runWithOutput(
      cli,
      ['install', 'skills'],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
    if (code === 0) {
      vscode.window.showInformationMessage('Wisp: Skills installed successfully.');
    } else {
      vscode.window.showErrorMessage(`Wisp: Install skills failed (exit code ${code}).`);
    }
  });
  context.subscriptions.push(cmd);
}

export function registerUpdateCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.update', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Wisp: Updating…', cancellable: false },
      async () => {
        const code = await runWithOutput(
          cli,
          ['update'],
          cwd,
          outputChannel,
          statusBar,
          onActivate,
          onDone,
        );
        if (code === 0) {
          vscode.window.showInformationMessage('Wisp: Updated successfully.');
        } else {
          vscode.window.showErrorMessage(`Wisp: Update failed (exit code ${code}).`);
        }
      },
    );
  });
  context.subscriptions.push(cmd);
}
