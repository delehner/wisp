import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispStatusBar } from '../statusBar';
import { registerGeneratePrdCommand, registerGenerateContextCommand } from '../commands/generate';

jest.mock('node:child_process');
const mockExec = cp.exec as jest.MockedFunction<typeof cp.exec>;
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function makeSpawnMock(exitCode = 0): jest.SpyInstance {
  return jest.spyOn(cp, 'spawn').mockReturnValue({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') setImmediate(() => cb(exitCode));
    }),
    kill: jest.fn(),
  } as unknown as cp.ChildProcess);
}

describe('registerGeneratePrdCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.OutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp');
    statusBar = new WispStatusBar();

    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  it('registers wisp.generatePrd command', () => {
    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.generatePrd',
      expect.any(Function),
    );
  });

  it('builds args with description and repo URLs as array elements (no shell interpolation)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')
      .mockResolvedValueOnce('https://github.com/org/repo1.git')
      .mockResolvedValueOnce('');

    const spawnMock = makeSpawnMock();

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'generate',
        'prd',
        '--description',
        'A new feature',
        '--repo',
        'https://github.com/org/repo1.git',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('builds args with multiple repo URLs as separate --repo flags', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Multi-repo feature')
      .mockResolvedValueOnce('https://github.com/org/repo1.git')
      .mockResolvedValueOnce('https://github.com/org/repo2.git')
      .mockResolvedValueOnce('');

    const spawnMock = makeSpawnMock();

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'generate',
        'prd',
        '--description',
        'Multi-repo feature',
        '--repo',
        'https://github.com/org/repo1.git',
        '--repo',
        'https://github.com/org/repo2.git',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('returns early without spawning when WispCli.resolve() returns null after inputs collected', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')
      .mockResolvedValueOnce('');
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when description input is cancelled', async () => {
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('registerGenerateContextCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.OutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp');
    statusBar = new WispStatusBar();

    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  it('registers wisp.generateContext command', () => {
    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.generateContext',
      expect.any(Function),
    );
  });

  it('builds args: generate context --repo --branch', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockImplementationOnce((opts: vscode.InputBoxOptions) => {
        expect(opts.validateInput?.('https://github.com/org/repo.git')).toBeUndefined();
        expect(opts.validateInput?.('ftp://bad')).toBe('Must start with https:// or git@');
        return Promise.resolve('https://github.com/org/repo.git');
      })
      .mockResolvedValueOnce('develop');

    const spawnMock = makeSpawnMock();

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['generate', 'context', '--repo', 'https://github.com/org/repo.git', '--branch', 'develop'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when WispCli.resolve() returns null after inputs collected', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git')
      .mockResolvedValueOnce('main');
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when repo URL input is cancelled', async () => {
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when branch input is cancelled (undefined)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git')
      .mockResolvedValueOnce(undefined); // branch cancelled

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('defaults branch to main when branch input is empty string', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git')
      .mockResolvedValueOnce(''); // empty string → defaults to 'main'

    const spawnMock = makeSpawnMock();

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['generate', 'context', '--repo', 'https://github.com/org/repo.git', '--branch', 'main'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });
});
