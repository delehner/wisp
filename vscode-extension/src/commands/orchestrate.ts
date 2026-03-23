import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { pickManifestFile, runWithOutput } from './utils';

export function registerOrchestrateCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.orchestrate', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp: No workspace folder open.');
      return;
    }

    const manifestPath = await pickManifestFile(cwd);
    if (!manifestPath) {
      return;
    }

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    await runWithOutput(
      cli,
      ['orchestrate', '--manifest', manifestPath],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
