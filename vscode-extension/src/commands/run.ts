import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { KNOWN_AGENTS, pickPrdFile, runWithOutput } from './utils';

export function registerRunCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.run', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }

    const agent = await vscode.window.showQuickPick(KNOWN_AGENTS, {
      placeHolder: 'Select an agent to run',
    });
    if (!agent) {
      return;
    }

    const workdir = await vscode.window.showInputBox({
      prompt: 'Working directory (repo root)',
      placeHolder: cwd,
      value: cwd,
    });
    if (!workdir) {
      return;
    }

    const prdPath = await pickPrdFile(cwd);
    if (!prdPath) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    await runWithOutput(
      cli,
      ['run', '--agent', agent, '--workdir', workdir, '--prd', prdPath],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
