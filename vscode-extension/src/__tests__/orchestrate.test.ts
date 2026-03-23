import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { registerOrchestrateCommand } from '../commands/orchestrate';

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

describe('registerOrchestrateCommand', () => {
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

  it('registers wisp.orchestrate command', () => {
    registerOrchestrateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.orchestrate',
      expect.any(Function),
    );
  });

  it('builds correct args: orchestrate --manifest <path>', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/manifests/test.json' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/manifests/test.json');

    const spawnMock = makeSpawnMock();

    registerOrchestrateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['orchestrate', '--manifest', '/workspace/manifests/test.json'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerOrchestrateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Wisp: No workspace folder open.',
    );
  });
});
