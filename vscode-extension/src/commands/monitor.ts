import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { runWithOutput } from './utils';

export function registerMonitorCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.monitor', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }

    // Capture available sessions from `wisp logs list`
    const result = await cli.runCapture(['logs', 'list'], cwd);
    const sessions = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (sessions.length === 0) {
      vscode.window.showInformationMessage(
        'Wisp: No log sessions found. Run a pipeline first, then use "Wisp: Monitor Logs".',
      );
      return;
    }

    const session = await vscode.window.showQuickPick(sessions, {
      placeHolder: 'Select a log session to monitor',
    });
    if (!session) {
      return;
    }

    await runWithOutput(
      cli,
      ['monitor', '--session', session],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
  });
  context.subscriptions.push(cmd);
}
