import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { runWithOutput } from './utils';

export function registerGeneratePrdCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.generatePrd', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: 'Project description',
      placeHolder: 'Describe the feature or project to generate PRDs for',
    });
    if (!description) {
      return;
    }

    const repoUrls: string[] = [];
    let addMore = true;
    while (addMore) {
      const repoUrl = await vscode.window.showInputBox({
        prompt: `Repo URL ${repoUrls.length + 1} (leave empty to finish)`,
        placeHolder: 'https://github.com/org/repo.git or leave empty to skip',
      });
      if (!repoUrl) {
        addMore = false;
      } else {
        repoUrls.push(repoUrl);
      }
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    const args = ['generate', 'prd', '--description', description];
    for (const url of repoUrls) {
      args.push('--repo', url);
    }

    await runWithOutput(cli, args, cwd, outputChannel, statusBar, onActivate, onDone);
  });
  context.subscriptions.push(cmd);
}

export function registerGenerateContextCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.generateContext', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }

    const repoUrl = await vscode.window.showInputBox({
      prompt: 'Repository URL',
      placeHolder: 'https://github.com/org/repo.git',
      validateInput: (val) =>
        val.startsWith('https://') || val.startsWith('git@')
          ? undefined
          : 'Must start with https:// or git@',
    });
    if (!repoUrl) {
      return;
    }

    const branch = await vscode.window.showInputBox({
      prompt: 'Branch to analyze',
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
      ['generate', 'context', '--repo', repoUrl, '--branch', branch || 'main'],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
