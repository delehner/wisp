import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { pickPrdFile, runWithOutput } from './utils';

function isValidRepoUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('git@');
}

export function registerPipelineCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.pipeline', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }

    const prdPath = await pickPrdFile(cwd);
    if (!prdPath) {
      return;
    }

    const repoUrl = await vscode.window.showInputBox({
      prompt: 'Repository URL',
      placeHolder: 'https://github.com/org/repo.git',
      validateInput: (val) =>
        isValidRepoUrl(val) ? undefined : 'Must start with https:// or git@',
    });
    if (!repoUrl) {
      return;
    }

    const branch = await vscode.window.showInputBox({
      prompt: 'Base branch',
      placeHolder: 'main',
      value: 'main',
    });
    if (branch === undefined) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    await runWithOutput(
      cli,
      ['pipeline', '--prd', prdPath, '--repo', repoUrl, '--branch', branch || 'main'],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
