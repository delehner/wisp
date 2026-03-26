import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { pickPrdFile, runWithOutput } from './utils';

function isValidRepoUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('git@');
}

export function registerPipelineCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.LogOutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.pipeline', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
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

    const contextDir = await vscode.window.showInputBox({
      prompt: 'Context directory (optional, press Enter to skip)',
      placeHolder: './contexts/my-repo',
      value: '',
    });
    if (contextDir === undefined) {
      return;
    }

    const rawIterations = await vscode.window.showInputBox({
      prompt: 'Max iterations per agent (--max-iterations)',
      value: '2',
    });
    if (rawIterations === undefined) {
      return;
    }
    const maxIterations = rawIterations || '2';

    const agents = await vscode.window.showInputBox({
      prompt: 'Agents to run, comma-separated (optional, press Enter to skip)',
      placeHolder: 'architect,developer,tester',
      value: '',
    });
    if (agents === undefined) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    const args = [
      'pipeline',
      '--prd',
      prdPath,
      '--repo',
      repoUrl,
      '--branch',
      branch || 'main',
      '--max-iterations',
      maxIterations,
    ];
    if (contextDir) {
      args.push('--context', contextDir);
    }
    if (agents) {
      args.push('--agents', agents);
    }

    await runWithOutput(cli, args, cwd, outputChannel, statusBar, onActivate, onDone);
  });
  context.subscriptions.push(cmd);
}
