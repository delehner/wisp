import * as vscode from 'vscode';
import { WispTreeItem } from './manifestTree';

export class PrdTreeDataProvider implements vscode.TreeDataProvider<WispTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WispTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly watcher: vscode.FileSystemWatcher;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/prds/**/*.md');
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.refresh());
    this.watcher.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this.watcher.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: WispTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WispTreeItem): Promise<WispTreeItem[]> {
    if (element) {
      return [];
    }

    const uris = await vscode.workspace.findFiles('**/prds/**/*.md');
    if (uris.length === 0) {
      const emptyItem = new WispTreeItem(
        'No PRDs found in workspace',
        vscode.TreeItemCollapsibleState.None,
      );
      emptyItem.tooltip = 'Create a prds/ directory with markdown PRD files to get started';
      return [emptyItem];
    }

    return uris
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      .map((uri) => {
        const label = vscode.workspace.asRelativePath(uri);
        const item = new WispTreeItem(label, vscode.TreeItemCollapsibleState.None, uri, {
          command: 'vscode.open',
          title: 'Open PRD',
          arguments: [uri],
        });
        item.iconPath = new vscode.ThemeIcon('book');
        item.contextValue = 'prdFile';
        item.tooltip = uri.fsPath;
        return item;
      });
  }
}
