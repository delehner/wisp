const vscode = {
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    createStatusBarItem: jest.fn(() => ({
      text: '',
      command: '',
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    withProgress: jest.fn((_opts: unknown, task: () => Promise<unknown>) => task()),
  },
  commands: {
    registerCommand: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn().mockReturnValue(''),
    })),
    findFiles: jest.fn().mockResolvedValue([]),
    workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  },
  env: {
    openExternal: jest.fn(),
  },
  Uri: {
    parse: jest.fn((url: string) => ({ toString: () => url })),
  },
  ExtensionContext: jest.fn(),
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ProgressLocation: {
    Notification: 15,
    SourceControl: 1,
    Window: 10,
  },
};

export = vscode;
