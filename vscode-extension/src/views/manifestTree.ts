import * as vscode from 'vscode';

export class WispTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri,
    public readonly command?: vscode.Command,
  ) {
    super(label, collapsibleState);
    this.resourceUri = resourceUri;
    this.command = command;
  }
}

export class ManifestTreeDataProvider implements vscode.TreeDataProvider<WispTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WispTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly watcher: vscode.FileSystemWatcher;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/manifests/**/*.json');
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

    const uris = await vscode.workspace.findFiles('**/manifests/**/*.json');
    if (uris.length === 0) {
      const emptyItem = new WispTreeItem(
        'No manifests found in workspace',
        vscode.TreeItemCollapsibleState.None,
      );
      emptyItem.tooltip = 'Create a manifests/ directory with JSON manifest files to get started';
      return [emptyItem];
    }

    return uris
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      .map((uri) => {
        const label = vscode.workspace.asRelativePath(uri);
        const item = new WispTreeItem(label, vscode.TreeItemCollapsibleState.None, uri, {
          command: 'wisp.orchestrate',
          title: 'Orchestrate',
          arguments: [uri],
        });
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.contextValue = 'manifestFile';
        item.tooltip = uri.fsPath;
        return item;
      });
  }
}
