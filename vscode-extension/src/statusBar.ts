import * as vscode from 'vscode';
import { WispCli } from './wispCli';

export class WispStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly cliFactory: () => Promise<WispCli | null>) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = { command: 'workbench.action.quickOpen', arguments: ['>Wisp '], title: '' };
    this.item.show();
  }

  async update(rootPath?: string): Promise<void> {
    // Show active root folder name when workspace has multiple roots
    const folders = vscode.workspace.workspaceFolders;
    const isMultiRoot = folders !== undefined && folders.length > 1;
    let rootLabel = '';
    if (isMultiRoot && rootPath) {
      const folder = folders.find((f) => f.uri.fsPath === rootPath);
      rootLabel = folder ? ` [${folder.name}]` : '';
    }

    const cli = await this.cliFactory();
    if (!cli) {
      this.item.text = '$(warning) Wisp: not found';
      this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
      return;
    }

    try {
      const result = await cli.runCapture(['--version'], process.cwd());
      const version = (result.stdout.trim() || result.stderr.trim()).split('\n')[0].trim();
      this.item.text = `$(circuit-board) Wisp ${version}${rootLabel}`;
      this.item.color = undefined;
    } catch {
      this.item.text = '$(warning) Wisp: not found';
      this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
