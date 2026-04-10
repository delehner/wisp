import * as vscode from 'vscode';
import {
  WispTreeItem,
  SectionItem,
  ManifestItem,
  EpicItem,
  SubtaskItem,
  PrdFolderItem,
  PrdFileItem,
  AgentItem,
  AgentFileItem,
  DevContainerFolderItem,
  DevContainerFileItem,
  ErrorItem,
  ManifestJson,
  EpicJson,
  SubtaskJson,
} from './items';

export class WispTreeDataProvider implements vscode.TreeDataProvider<WispTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WispTreeItem | undefined | null>();
  readonly onDidChangeTreeData: vscode.Event<WispTreeItem | undefined | null> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: WispTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WispTreeItem): Promise<WispTreeItem[]> {
    if (!element) {
      return [
        new SectionItem('Manifests'),
        new SectionItem('PRDs'),
        new SectionItem('Agents'),
        new SectionItem('Dev Containers'),
      ];
    }

    if (element instanceof SectionItem) {
      switch (element.sectionLabel) {
        case 'Manifests':
          return this._getManifestChildren();
        case 'PRDs':
          return this._getPrdFolderChildren();
        case 'Agents':
          return this._getAgentChildren();
        case 'Dev Containers':
          return this._getDevContainerChildren();
      }
    }

    if (element instanceof ManifestItem) {
      return element.epics.map(
        (epic) =>
          new EpicItem(
            epic.name ?? 'Unnamed Epic',
            element.fsPath,
            epic.subtasks ?? epic.prds ?? [],
          ),
      );
    }

    if (element instanceof EpicItem) {
      return element.subtasks.map((subtask: SubtaskJson) => {
        const repoUrl = subtask.repositories?.[0]?.url ?? '';
        const branch = subtask.repositories?.[0]?.branch ?? 'main';
        return new SubtaskItem(subtask.prd, repoUrl, element.manifestFsPath, branch);
      });
    }

    if (element instanceof PrdFolderItem) {
      return this._getPrdFileChildren(element.fileUris);
    }

    if (element instanceof AgentItem) {
      return element.fileUris.map((uri) => new AgentFileItem(uri.fsPath));
    }

    if (element instanceof DevContainerFolderItem) {
      return element.fileUris.map((uri) => new DevContainerFileItem(uri.fsPath));
    }

    return [];
  }

  private async _getManifestChildren(): Promise<WispTreeItem[]> {
    const uris = await vscode.workspace.findFiles('**/.devenv/manifests/*.json');
    if (uris.length === 0) {
      return [];
    }

    const items: WispTreeItem[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf8');
        const json: ManifestJson = JSON.parse(text);
        const epics: EpicJson[] = json.epics ?? json.orders ?? [];
        const name = json.name ?? uri.fsPath.split('/').pop()?.replace(/\.json$/, '') ?? 'Manifest';
        items.push(new ManifestItem(name, uri.fsPath, epics));
      } catch {
        items.push(new ErrorItem(uri.fsPath, 'Invalid JSON'));
      }
    }
    return items;
  }

  private async _getPrdFolderChildren(): Promise<WispTreeItem[]> {
    const uris = await vscode.workspace.findFiles('**/.devenv/prds/**/*.md');
    if (uris.length === 0) {
      return [];
    }

    // Group by immediate subdirectory under prds/
    const folderMap = new Map<string, vscode.Uri[]>();
    for (const uri of uris) {
      const parts = uri.fsPath.split('/');
      const prdsIdx = parts.lastIndexOf('prds');
      const dirName = prdsIdx >= 0 && prdsIdx + 1 < parts.length - 1
        ? parts[prdsIdx + 1]
        : '(root)';
      const existing = folderMap.get(dirName) ?? [];
      existing.push(uri);
      folderMap.set(dirName, existing);
    }

    return Array.from(folderMap.entries()).map(
      ([dirName, fileUris]) => new PrdFolderItem(dirName, fileUris),
    );
  }

  private async _getPrdFileChildren(uris: vscode.Uri[]): Promise<WispTreeItem[]> {
    const items: WispTreeItem[] = [];
    for (const uri of uris) {
      const { title, status } = await this._extractPrdMeta(uri);
      items.push(new PrdFileItem(uri.fsPath, title, status));
    }
    return items;
  }

  private async _getAgentChildren(): Promise<WispTreeItem[]> {
    const uris = await vscode.workspace.findFiles('**/.ai/agents/**/*.md');
    if (uris.length === 0) {
      return [];
    }

    const agentMap = new Map<string, { dirUri: vscode.Uri; fileUris: vscode.Uri[] }>();
    const rootFiles: vscode.Uri[] = [];

    for (const uri of uris) {
      const parts = uri.fsPath.split('/');
      const agentsIdx = parts.lastIndexOf('agents');
      if (agentsIdx < 0) {
        continue;
      }
      const depth = parts.length - agentsIdx - 1;
      if (depth === 1) {
        rootFiles.push(uri);
      } else if (depth >= 2) {
        const dirName = parts[agentsIdx + 1];
        const existing = agentMap.get(dirName);
        if (existing) {
          existing.fileUris.push(uri);
        } else {
          const dirPath = parts.slice(0, agentsIdx + 2).join('/');
          agentMap.set(dirName, {
            dirUri: vscode.Uri.file(dirPath),
            fileUris: [uri],
          });
        }
      }
    }

    const items: WispTreeItem[] = [];

    for (const uri of rootFiles) {
      items.push(new AgentFileItem(uri.fsPath));
    }

    const sortedEntries = Array.from(agentMap.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [dirName, { dirUri, fileUris }] of sortedEntries) {
      items.push(new AgentItem(dirName, dirUri, fileUris));
    }

    return items;
  }

  private async _getDevContainerChildren(): Promise<WispTreeItem[]> {
    const uris = await vscode.workspace.findFiles('**/.devenv/.devcontainer/agent/**');
    if (uris.length === 0) {
      return [];
    }

    // All devcontainer files live under .devenv/.devcontainer/agent/
    return [new DevContainerFolderItem('devcontainer', uris)];
  }

  private async _extractPrdMeta(uri: vscode.Uri): Promise<{ title: string; status: string }> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const lines = text.split('\n').slice(0, 10);
      let title = '';
      let status = '';
      for (const line of lines) {
        if (!title) {
          const titleMatch = /^#\s+(.+)/.exec(line);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
        }
        if (!status) {
          const statusMatch = /^>\s*\*\*Status\*\*:\s*(.+)/.exec(line);
          if (statusMatch) {
            status = statusMatch[1].trim();
          }
        }
      }
      return { title, status };
    } catch {
      return { title: '', status: '' };
    }
  }
}
