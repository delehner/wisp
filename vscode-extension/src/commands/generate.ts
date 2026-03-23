import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { runWithOutput } from './utils';

function repoNameFromUrl(url: string): string {
  const last = url.split('/').pop() ?? url;
  return last.endsWith('.git') ? last.slice(0, -4) : last;
}

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
      vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: 'Project description',
      placeHolder: 'Describe the feature or project to generate PRDs for',
    });
    if (!description) {
      return;
    }

    const output = await vscode.window.showInputBox({
      prompt: 'Output directory for generated PRDs',
      value: './prds',
      validateInput: (val) => (val.trim() ? undefined : 'Output directory is required'),
    });
    if (output === undefined) {
      return;
    }

    const manifestPath = await vscode.window.showInputBox({
      prompt: 'Manifest JSON path',
      value: './manifests/project.json',
      validateInput: (val) => (val.trim() ? undefined : 'Manifest path is required'),
    });
    if (manifestPath === undefined) {
      return;
    }

    const repoPairs: Array<{ url: string; context: string }> = [];
    let addMore = true;
    while (addMore) {
      const repoUrl = await vscode.window.showInputBox({
        prompt: `Repo URL ${repoPairs.length + 1} (leave empty to finish)`,
        placeHolder: 'https://github.com/org/repo.git or leave empty to skip',
      });
      if (!repoUrl) {
        addMore = false;
      } else {
        const contextPath = await vscode.window.showInputBox({
          prompt: 'Context directory for this repo (optional, press Enter to skip)',
          value: '',
        });
        if (contextPath === undefined) {
          return;
        }
        repoPairs.push({ url: repoUrl, context: contextPath });
      }
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    const args = [
      'generate',
      'prd',
      '--output',
      output,
      '--manifest',
      manifestPath,
      '--description',
      description,
      ...repoPairs.flatMap((p) =>
        p.context ? ['--repo', p.url, '--context', p.context] : ['--repo', p.url],
      ),
    ];

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
      vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
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

    const defaultOutput = `./contexts/${repoNameFromUrl(repoUrl)}`;
    const output = await vscode.window.showInputBox({
      prompt: 'Output directory for context skills',
      value: defaultOutput,
      validateInput: (val) => (val.trim() ? undefined : 'Output directory is required'),
    });
    if (output === undefined) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    await runWithOutput(
      cli,
      ['generate', 'context', '--repo', repoUrl, '--branch', branch || 'main', '--output', output],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
