import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispCli } from '../wispCli';
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
});
