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
  let outputChannel: vscode.LogOutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp AI', { log: true });
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

  it('builds args with --output, --manifest, --description, and --repo', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')       // description
      .mockResolvedValueOnce('./prds')               // output dir
      .mockResolvedValueOnce('./manifests/project.json') // manifest path
      .mockResolvedValueOnce('https://github.com/org/repo1.git') // repo URL
      .mockResolvedValueOnce('')                     // context for repo (empty = skip)
      .mockResolvedValueOnce('');                    // empty URL to finish loop

    const spawnMock = makeSpawnMock();

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'generate',
        'prd',
        '--output',
        './prds',
        '--manifest',
        './manifests/project.json',
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
      .mockResolvedValueOnce('Multi-repo feature')   // description
      .mockResolvedValueOnce('./prds')               // output dir
      .mockResolvedValueOnce('./manifests/project.json') // manifest path
      .mockResolvedValueOnce('https://github.com/org/repo1.git') // repo URL 1
      .mockResolvedValueOnce('')                     // context for repo1 (empty)
      .mockResolvedValueOnce('https://github.com/org/repo2.git') // repo URL 2
      .mockResolvedValueOnce('')                     // context for repo2 (empty)
      .mockResolvedValueOnce('');                    // empty URL to finish loop

    const spawnMock = makeSpawnMock();

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'generate',
        'prd',
        '--output',
        './prds',
        '--manifest',
        './manifests/project.json',
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

  it('includes --context when a context path is provided for a repo', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Feature with context') // description
      .mockResolvedValueOnce('./prds')               // output dir
      .mockResolvedValueOnce('./manifests/project.json') // manifest path
      .mockResolvedValueOnce('https://github.com/org/repo1.git') // repo URL
      .mockResolvedValueOnce('./contexts/repo1')     // context for repo1 (has value)
      .mockResolvedValueOnce('');                    // empty URL to finish loop

    const spawnMock = makeSpawnMock();

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'generate',
        'prd',
        '--output',
        './prds',
        '--manifest',
        './manifests/project.json',
        '--description',
        'Feature with context',
        '--repo',
        'https://github.com/org/repo1.git',
        '--context',
        './contexts/repo1',
      ],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('returns early without spawning when WispCli.resolve() returns null after inputs collected', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')        // description
      .mockResolvedValueOnce('./prds')               // output dir
      .mockResolvedValueOnce('./manifests/project.json') // manifest path
      .mockResolvedValueOnce('');                    // empty URL to finish loop
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

  it('returns early without spawning when output dir is cancelled (undefined)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature') // description
      .mockResolvedValueOnce(undefined);       // output dir cancelled

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when manifest path is cancelled (undefined)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')  // description
      .mockResolvedValueOnce('./prds')          // output dir
      .mockResolvedValueOnce(undefined);        // manifest path cancelled

    registerGeneratePrdCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when context prompt is cancelled (undefined) mid-loop', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('A new feature')        // description
      .mockResolvedValueOnce('./prds')               // output dir
      .mockResolvedValueOnce('./manifests/project.json') // manifest path
      .mockResolvedValueOnce('https://github.com/org/repo1.git') // repo URL
      .mockResolvedValueOnce(undefined);             // context cancelled → abort

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

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('registerGenerateContextCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.LogOutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp AI', { log: true });
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

  it('builds args: generate context --repo --branch --output', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockImplementationOnce((opts: vscode.InputBoxOptions) => {
        expect(opts.validateInput?.('https://github.com/org/repo.git')).toBeUndefined();
        expect(opts.validateInput?.('ftp://bad')).toBe('Must start with https:// or git@');
        return Promise.resolve('https://github.com/org/repo.git');
      })
      .mockResolvedValueOnce('develop')               // branch
      .mockResolvedValueOnce('./contexts/repo');       // output dir

    const spawnMock = makeSpawnMock();

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['generate', 'context', '--repo', 'https://github.com/org/repo.git', '--branch', 'develop', '--output', './contexts/repo'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('derives default output from repo URL (strips .git)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/my-repo.git') // repo URL
      .mockResolvedValueOnce('main')                               // branch
      .mockImplementationOnce((opts: vscode.InputBoxOptions) => {
        // default output should be ./contexts/my-repo
        expect(opts.value).toBe('./contexts/my-repo');
        return Promise.resolve('./contexts/my-repo');
      });

    const spawnMock = makeSpawnMock();

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--output', './contexts/my-repo']),
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('returns early without spawning when WispCli.resolve() returns null after inputs collected', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repo URL
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce('./contexts/repo');                // output dir
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

  it('returns early without spawning when output dir is cancelled (undefined)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repo URL
      .mockResolvedValueOnce('main')                            // branch
      .mockResolvedValueOnce(undefined);                        // output dir cancelled

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('defaults branch to main when branch input is empty string', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('https://github.com/org/repo.git') // repo URL
      .mockResolvedValueOnce('')                                 // empty string → defaults to 'main'
      .mockResolvedValueOnce('./contexts/repo');                 // output dir

    const spawnMock = makeSpawnMock();

    registerGenerateContextCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['generate', 'context', '--repo', 'https://github.com/org/repo.git', '--branch', 'main', '--output', './contexts/repo'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });
});
