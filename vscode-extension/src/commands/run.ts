import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { KNOWN_AGENTS, pickPrdFile, runWithOutput } from './utils';

export function registerRunCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.LogOutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.run', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
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

    const rawIterations = await vscode.window.showInputBox({
      prompt: 'Max iterations (--max-iterations)',
      value: '2',
    });
    if (rawIterations === undefined) {
      return;
    }
    const maxIterations = rawIterations || '2';

    const model = await vscode.window.showInputBox({
      prompt: 'Model override (optional, press Enter to skip)',
      placeHolder: 'claude-opus-4-5, sonnet, ...',
      value: '',
    });
    if (model === undefined) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    const args = ['run', '--agent', agent, '--workdir', workdir, '--prd', prdPath, '--max-iterations', maxIterations];
    if (model) {
      args.push('--model', model);
    }

    await runWithOutput(cli, args, cwd, outputChannel, statusBar, onActivate, onDone);
  });
  context.subscriptions.push(cmd);
}
