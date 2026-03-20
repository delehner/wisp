class EventEmitter<T> {
  fire = jest.fn((_event?: T) => {});
  event = jest.fn();
  dispose = jest.fn();
}

class ThemeIcon {
  constructor(public readonly id: string) {}
}

class ThemeColor {
  constructor(public readonly id: string) {}
}

class TreeItem {
  label: string | undefined;
  collapsibleState: number | undefined;
  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const ProgressLocation = {
  Notification: 15,
  SourceControl: 1,
  Window: 10,
};

const ViewColumn = {
  Beside: -2,
  Active: -1,
  One: 1,
  Two: 2,
  Three: 3,
};

const vscode = {
  EventEmitter,
  ThemeIcon,
  ThemeColor,
  TreeItem,
  TreeItemCollapsibleState,
  StatusBarAlignment,
  ProgressLocation,
  ViewColumn,

  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showTextDocument: jest.fn(),
    createStatusBarItem: jest.fn(() => ({
      text: '',
      color: undefined,
      command: undefined,
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    createWebviewPanel: jest.fn(),
    createTreeView: jest.fn(() => ({ dispose: jest.fn() })),
    withProgress: jest.fn(
      (
        _opts: unknown,
        task: (_progress: unknown, token: unknown) => Promise<unknown>,
      ) => task({}, { isCancellationRequested: false, onCancellationRequested: jest.fn() }),
    ),
  },

  commands: {
    registerCommand: jest.fn(),
    getCommands: jest.fn().mockResolvedValue([]),
  },

  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn().mockReturnValue(''),
      inspect: jest.fn().mockReturnValue(undefined),
    })),
    findFiles: jest.fn().mockResolvedValue([]),
    asRelativePath: jest.fn((uri: { fsPath?: string } | string) =>
      typeof uri === 'string' ? uri : (uri.fsPath ?? ''),
    ),
    openTextDocument: jest.fn().mockResolvedValue({}),
    workspaceFolders: undefined as unknown,
    onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    createFileSystemWatcher: jest.fn(() => ({
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      onDidChange: jest.fn(),
      dispose: jest.fn(),
    })),
  },

  env: {
    openExternal: jest.fn(),
  },

  Uri: {
    parse: jest.fn((url: string) => ({ toString: () => url })),
    joinPath: jest.fn((base: unknown, ...parts: string[]) => {
      const fsPath = `${(base as { fsPath?: string }).fsPath ?? ''}/${parts.join('/')}`;
      return { fsPath, toString: () => fsPath };
    }),
  },

  ExtensionContext: jest.fn(),
};

export = vscode;
