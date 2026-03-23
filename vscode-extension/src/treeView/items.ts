import * as vscode from 'vscode';

export const CONTEXT_VALUES = {
  section: 'wispSection',
  manifest: 'wispManifest',
  epic: 'wispEpic',
  subtask: 'wispSubtask',
  prdFolder: 'wispPrdFolder',
  prd: 'wispPrd',
  error: 'wispError',
} as const;

export type ContextValue = (typeof CONTEXT_VALUES)[keyof typeof CONTEXT_VALUES];

export class WispTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextVal: ContextValue,
  ) {
    super(label, collapsibleState);
    this.contextValue = contextVal;
  }
}

export class SectionItem extends WispTreeItem {
  constructor(public readonly sectionLabel: 'Manifests' | 'PRDs') {
    super(sectionLabel, vscode.TreeItemCollapsibleState.Expanded, CONTEXT_VALUES.section);
    this.tooltip = sectionLabel;
  }
}

export class ManifestItem extends WispTreeItem {
  constructor(
    public readonly manifestName: string,
    public readonly fsPath: string,
    public readonly epics: EpicJson[],
  ) {
    super(manifestName, vscode.TreeItemCollapsibleState.Collapsed, CONTEXT_VALUES.manifest);
    this.tooltip = new vscode.MarkdownString(`**${manifestName}**\n\n${fsPath}`);
    this.description = fsPath.split('/').pop();
    this.iconPath = new vscode.ThemeIcon('file-code');
  }
}

export class EpicItem extends WispTreeItem {
  constructor(
    public readonly epicName: string,
    public readonly manifestFsPath: string,
    public readonly subtasks: SubtaskJson[],
  ) {
    super(epicName, vscode.TreeItemCollapsibleState.Collapsed, CONTEXT_VALUES.epic);
    this.tooltip = epicName;
    this.iconPath = new vscode.ThemeIcon('list-ordered');
  }
}

export class SubtaskItem extends WispTreeItem {
  constructor(
    public readonly prdPath: string,
    public readonly repoUrl: string,
    public readonly manifestFsPath: string,
  ) {
    const label = prdPath.split('/').pop() ?? prdPath;
    super(label, vscode.TreeItemCollapsibleState.None, CONTEXT_VALUES.subtask);
    this.tooltip = prdPath;
    this.description = repoUrl;
    this.iconPath = new vscode.ThemeIcon('file');
  }
}

export class PrdFolderItem extends WispTreeItem {
  constructor(
    public readonly dirName: string,
    public readonly fileUris: vscode.Uri[],
  ) {
    super(dirName, vscode.TreeItemCollapsibleState.Collapsed, CONTEXT_VALUES.prdFolder);
    this.tooltip = dirName;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class PrdFileItem extends WispTreeItem {
  constructor(
    public readonly fsPath: string,
    title: string,
    status: string,
  ) {
    const label = fsPath.split('/').pop() ?? fsPath;
    super(label, vscode.TreeItemCollapsibleState.None, CONTEXT_VALUES.prd);
    this.tooltip = new vscode.MarkdownString(`**${title || label}**\n\nStatus: ${status || 'Unknown'}`);
    this.description = status || undefined;
    this.iconPath = new vscode.ThemeIcon('file');
    this.command = {
      command: 'wisp.explorer.openFile',
      title: 'Open File',
      arguments: [fsPath],
    };
  }
}

export class ErrorItem extends WispTreeItem {
  constructor(public readonly fsPath: string, message: string) {
    super(`⚠ ${message}`, vscode.TreeItemCollapsibleState.None, CONTEXT_VALUES.error);
    this.tooltip = `Error in ${fsPath}: ${message}`;
    this.iconPath = new vscode.ThemeIcon('warning');
  }
}

// JSON shape interfaces (matching Rust manifest serde aliases)
export interface ManifestJson {
  name?: string;
  description?: string;
  epics?: EpicJson[];
  orders?: EpicJson[];
}

export interface EpicJson {
  name?: string;
  subtasks?: SubtaskJson[];
  prds?: SubtaskJson[];
}

export interface SubtaskJson {
  prd: string;
  repositories?: Array<{ url: string; branch?: string }>;
}
