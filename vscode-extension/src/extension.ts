import * as vscode from 'vscode';
import { WispCli } from './wispCli';

let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Wisp');
  context.subscriptions.push(outputChannel);

  const showVersion = vscode.commands.registerCommand('wisp.showVersion', async () => {
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    const result = await cli.runCapture(['--version'], process.cwd());
    const version = result.stdout.trim() || result.stderr.trim();
    vscode.window.showInformationMessage(`Wisp version: ${version}`);
  });

  context.subscriptions.push(showVersion);
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
