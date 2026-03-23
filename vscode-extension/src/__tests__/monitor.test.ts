import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispStatusBar } from '../statusBar';
import { registerMonitorCommand } from '../commands/monitor';

jest.mock('node:child_process');
const mockExec = cp.exec as jest.MockedFunction<typeof cp.exec>;
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function makeSpawnMock(stdoutData = '', exitCode = 0): jest.SpyInstance {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const mock = jest.spyOn(cp, 'spawn').mockReturnValue({
    stdout,
    stderr,
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') {
        setImmediate(() => {
          if (stdoutData) stdout.push(stdoutData);
          stdout.end();
          stderr.end();
          cb(exitCode);
        });
      }
    }),
    kill: jest.fn(),
  } as unknown as cp.ChildProcess);
  return mock;
}

describe('registerMonitorCommand', () => {
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

  it('returns early when no workspace folder is open and binary is not found', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    // WispCli.resolve() fails → command returns early; the important thing is no crash
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('registers wisp.monitor command', () => {
    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.monitor',
      expect.any(Function),
    );
  });

  it('returns early without spawning when WispCli.resolve() returns null', async () => {
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('shows informational message when no sessions exist', async () => {
    // spawn returns empty stdout → runCapture returns empty stdout string
    const spawnMock = makeSpawnMock('');

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No log sessions found'),
    );

    spawnMock.mockRestore();
  });

  it('shows QuickPick with session list when sessions exist', async () => {
    const spawnMock = makeSpawnMock('session-20240101\nsession-20240102\n');

    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining(['session-20240101', 'session-20240102']),
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('uses process.cwd() for logs list when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    // spawn returns empty stdout so the "no sessions" message is shown — we just
    // care that the command doesn't throw and that spawn was called with process.cwd()
    const spawnMock = makeSpawnMock('');

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['logs', 'list'],
      expect.objectContaining({ cwd: process.cwd() }),
    );

    spawnMock.mockRestore();
  });

  it('builds correct args when a session is selected: monitor --session <id>', async () => {
    // First spawn returns sessions list (runCapture), second spawn runs monitor
    let spawnCallCount = 0;
    jest.spyOn(cp, 'spawn').mockImplementation(() => {
      spawnCallCount++;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = {
        stdout,
        stderr,
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => {
              if (spawnCallCount === 1) {
                // First call: emit session list then close
                stdout.push('session-20240101\n');
              }
              stdout.end();
              stderr.end();
              cb(0);
            });
          }
        }),
        kill: jest.fn(),
      };
      return proc as unknown as cp.ChildProcess;
    });

    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('session-20240101');

    registerMonitorCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    // The second spawn call should be the monitor invocation
    const spawnCalls = (cp.spawn as jest.Mock).mock.calls;
    const monitorCall = spawnCalls.find((call: unknown[]) =>
      Array.isArray(call[1]) && call[1].includes('monitor'),
    );
    expect(monitorCall).toBeDefined();
    expect(monitorCall[1]).toEqual(['monitor', '--session', 'session-20240101']);

    jest.restoreAllMocks();
  });
});
