import { PassThrough } from 'node:stream';
import * as cp from 'node:child_process';
import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';
import { KNOWN_AGENTS, pickManifestFile, pickPrdFile, runWithOutput, registerInstallSkillsCommand, registerUpdateCommand } from '../commands/utils';

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

function resolvedCli(): void {
  mockExec.mockImplementation((_cmd, callback: unknown) => {
    (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
    return {} as cp.ChildProcess;
  });
}

describe('KNOWN_AGENTS', () => {
  it('contains all 14 agents', () => {
    expect(KNOWN_AGENTS).toHaveLength(14);
    expect(KNOWN_AGENTS).toContain('architect');
    expect(KNOWN_AGENTS).toContain('developer');
    expect(KNOWN_AGENTS).toContain('tester');
    expect(KNOWN_AGENTS).toContain('reviewer');
    expect(KNOWN_AGENTS).toContain('designer');
    expect(KNOWN_AGENTS).toContain('migration');
    expect(KNOWN_AGENTS).toContain('accessibility');
    expect(KNOWN_AGENTS).toContain('performance');
    expect(KNOWN_AGENTS).toContain('secops');
    expect(KNOWN_AGENTS).toContain('dependency');
    expect(KNOWN_AGENTS).toContain('infrastructure');
    expect(KNOWN_AGENTS).toContain('devops');
    expect(KNOWN_AGENTS).toContain('rollback');
    expect(KNOWN_AGENTS).toContain('documentation');
  });
});

describe('pickManifestFile()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows QuickPick when workspace files are found', async () => {
    const fakeUri = { fsPath: '/workspace/manifests/test.json' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([fakeUri]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/manifests/test.json');

    const result = await pickManifestFile('/workspace');

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/manifests/*.json');
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      ['/workspace/manifests/test.json'],
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
    expect(result).toBe('/workspace/manifests/test.json');
  });

  it('falls back to showInputBox when no files found', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('/manually/typed/path.json');

    const result = await pickManifestFile('/workspace');

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBe('/manually/typed/path.json');
  });
});

describe('pickPrdFile()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows QuickPick when workspace PRD files are found', async () => {
    const fakeUri = { fsPath: '/workspace/prds/my-feature/prd.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([fakeUri]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/my-feature/prd.md');

    const result = await pickPrdFile('/workspace');

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/prds/**/*.md');
    expect(result).toBe('/workspace/prds/my-feature/prd.md');
  });

  it('falls back to showInputBox when no PRD files found', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);

    const result = await pickPrdFile('/workspace');

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe('runWithOutput() — stdout/stderr piping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolvedCli();
  });

  it('pipes stdout and stderr lines to the output channel', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let closeCallback: ((code: number | null) => void) | undefined;

    jest.spyOn(cp, 'spawn').mockReturnValue({
      stdout,
      stderr,
      on: jest.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') closeCallback = cb;
      }),
      kill: jest.fn(),
    } as unknown as cp.ChildProcess);

    const cli = await WispCli.resolve();
    const outputChannel = vscode.window.createOutputChannel('Wisp');
    const statusBar = new WispStatusBar();

    const runPromise = runWithOutput(cli!, ['orchestrate'], '/tmp', outputChannel, statusBar);

    setImmediate(() => {
      stdout.push('hello from stdout\n');
      stderr.push('warn from stderr\n');
      closeCallback?.(0);
    });

    const code = await runPromise;
    expect(code).toBe(0);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('hello from stdout'));
    expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('warn from stderr'));
  });
});

describe('runWithOutput() — already-running guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolvedCli();
  });

  it('shows warning and returns 1 when a pipeline is already running', async () => {
    // Keep a process open so isRunning stays true
    let closeCallback: ((code: number | null) => void) | undefined;
    jest.spyOn(cp, 'spawn').mockReturnValue({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      on: jest.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') closeCallback = cb;
      }),
      kill: jest.fn(),
    } as unknown as cp.ChildProcess);

    const cli = await WispCli.resolve();
    const outputChannel = vscode.window.createOutputChannel('Wisp');
    const statusBar = new WispStatusBar();

    // Start first run (don't await — process stays open)
    const firstRun = cli!.run(['orchestrate'], '/tmp', jest.fn(), jest.fn());
    expect(cli!.isRunning).toBe(true);

    // Second runWithOutput call should be blocked
    const code = await runWithOutput(cli!, ['orchestrate'], '/tmp', outputChannel, statusBar);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'A Wisp pipeline is already running.',
    );
    expect(code).toBe(1);

    // Clean up — resolve the first run
    closeCallback?.(0);
    await firstRun;
  });
});

describe('registerInstallSkillsCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.OutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    resolvedCli();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp');
    statusBar = new WispStatusBar();
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  it('registers wisp.installSkills command', () => {
    registerInstallSkillsCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.installSkills',
      expect.any(Function),
    );
  });

  it('builds correct args: install skills', async () => {
    const spawnMock = makeSpawnMock(0);

    registerInstallSkillsCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['install', 'skills'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('shows success notification when exit code is 0', async () => {
    const spawnMock = makeSpawnMock(0);

    registerInstallSkillsCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Wisp: Skills installed successfully.',
    );

    spawnMock.mockRestore();
  });

  it('shows error notification when exit code is non-zero', async () => {
    const spawnMock = makeSpawnMock(1);

    registerInstallSkillsCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('exit code 1'),
    );

    spawnMock.mockRestore();
  });

  it('shows error when no workspace folder is open', async () => {
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    registerInstallSkillsCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp: No workspace folder open.');
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('registerUpdateCommand', () => {
  let context: vscode.ExtensionContext;
  let outputChannel: vscode.OutputChannel;
  let statusBar: WispStatusBar;

  beforeEach(() => {
    jest.clearAllMocks();
    resolvedCli();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
    outputChannel = vscode.window.createOutputChannel('Wisp');
    statusBar = new WispStatusBar();
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  it('registers wisp.update command', () => {
    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'wisp.update',
      expect.any(Function),
    );
  });

  it('builds correct args: update', async () => {
    const spawnMock = makeSpawnMock(0);

    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['update'],
      expect.any(Object),
    );

    spawnMock.mockRestore();
  });

  it('wraps execution in withProgress notification', async () => {
    const spawnMock = makeSpawnMock(0);

    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ location: vscode.ProgressLocation.Notification }),
      expect.any(Function),
    );

    spawnMock.mockRestore();
  });

  it('shows success notification when exit code is 0', async () => {
    const spawnMock = makeSpawnMock(0);

    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Wisp: Updated successfully.',
    );

    spawnMock.mockRestore();
  });

  it('shows error notification when exit code is non-zero', async () => {
    const spawnMock = makeSpawnMock(1);

    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('exit code 1'),
    );

    spawnMock.mockRestore();
  });

  it('returns early when WispCli.resolve() returns null', async () => {
    // Force resolve to fail
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    registerUpdateCommand(context, outputChannel, statusBar, jest.fn(), jest.fn());
    const [[, handler]] = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    await handler();

    expect(vscode.window.withProgress).not.toHaveBeenCalled();
  });
});
