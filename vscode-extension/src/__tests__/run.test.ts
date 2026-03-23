import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { registerRunCommand } from '../commands/run';
import { KNOWN_AGENTS } from '../commands/utils';

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

describe('registerRunCommand', () => {
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

  it('registers wisp.run command', () => {
    registerRunCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('wisp.run', expect.any(Function));
  });

  it('shows all 14 agents in QuickPick', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    registerRunCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      KNOWN_AGENTS,
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
  });

  it('builds correct args: run --agent --workdir --prd', async () => {
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce('developer')
      .mockResolvedValueOnce('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('/workspace');
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);

    const spawnMock = makeSpawnMock();

    registerRunCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'run',
        '--agent',
        'developer',
        '--workdir',
        '/workspace',
        '--prd',
        '/workspace/prds/feat/prd.md',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });
});
