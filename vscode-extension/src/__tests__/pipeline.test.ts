import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { WispStatusBar } from '../statusBar';
import { registerPipelineCommand } from '../commands/pipeline';

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

describe('registerPipelineCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.OutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp AI');
    statusBar = new WispStatusBar();

    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  it('registers wisp.pipeline command', () => {
    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.pipeline',
      expect.any(Function),
    );
  });

  it('builds correct args: pipeline --prd --repo --branch --max-iterations (no context, no agents)', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repoUrl
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce('')                                // context (empty = skip)
      .mockResolvedValueOnce('2')                               // max-iterations
      .mockResolvedValueOnce('');                               // agents (empty = skip)

    const spawnMock = makeSpawnMock();

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'pipeline',
        '--prd',
        '/workspace/prds/feat/prd.md',
        '--repo',
        'https://github.com/org/repo.git',
        '--branch',
        'main',
        '--max-iterations',
        '2',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('includes --context when context dir is provided', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repoUrl
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce('./contexts/my-repo')              // context (has value)
      .mockResolvedValueOnce('2')                               // max-iterations
      .mockResolvedValueOnce('');                               // agents (empty = skip)

    const spawnMock = makeSpawnMock();

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'pipeline',
        '--prd',
        '/workspace/prds/feat/prd.md',
        '--repo',
        'https://github.com/org/repo.git',
        '--branch',
        'main',
        '--max-iterations',
        '2',
        '--context',
        './contexts/my-repo',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('includes --agents when agents override is provided', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repoUrl
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce('')                                // context (empty)
      .mockResolvedValueOnce('2')                               // max-iterations
      .mockResolvedValueOnce('architect,developer');            // agents (has value)

    const spawnMock = makeSpawnMock();

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--agents', 'architect,developer']),
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when prd picker is cancelled', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when branch input is cancelled (undefined)', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git')
      .mockResolvedValueOnce(undefined); // branch cancelled

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when WispCli.resolve() returns null after inputs collected', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repoUrl
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce('')                                // context
      .mockResolvedValueOnce('2')                               // max-iterations
      .mockResolvedValueOnce('');                               // agents
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('uses "main" as fallback when branch input is empty string', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git')
      .mockResolvedValueOnce('') // user clears the branch field → branch || 'main'
      .mockResolvedValueOnce('') // context (empty)
      .mockResolvedValueOnce('2') // max-iterations
      .mockResolvedValueOnce(''); // agents (empty)

    const spawnMock = makeSpawnMock();

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'pipeline',
        '--prd',
        '/workspace/prds/feat/prd.md',
        '--repo',
        'https://github.com/org/repo.git',
        '--branch',
        'main',
        '--max-iterations',
        '2',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('validates repo URL — rejects invalid URL', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      { fsPath: '/workspace/prds/feat/prd.md' },
    ]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/feat/prd.md');

    (vscode.window.showInputBox as jest.Mock).mockImplementation(
      (opts: vscode.InputBoxOptions) => {
        expect(opts.validateInput?.('not-a-url')).toBe('Must start with https:// or git@');
        expect(opts.validateInput?.('https://github.com/org/repo.git')).toBeUndefined();
        return Promise.resolve(undefined); // user cancelled
      },
    );

    registerPipelineCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });
});
