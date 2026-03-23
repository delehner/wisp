import * as cp from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import { WispCli } from '../wispCli';

jest.mock('node:child_process');
const mockExec = cp.exec as jest.MockedFunction<typeof cp.exec>;
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('WispCli.resolve()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(''),
    });
  });

  it('returns WispCli instance when binaryPath workspace setting is configured', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('/usr/local/bin/wisp'),
    });

    const cli = await WispCli.resolve();

    expect(cli).not.toBeNull();
    expect(cp.exec).not.toHaveBeenCalled();
  });

  it('falls back to which/where when binaryPath setting is empty', async () => {
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    const cli = await WispCli.resolve();

    expect(cli).not.toBeNull();
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('wisp'),
      expect.any(Function),
    );
  });

  it('returns null and shows install prompt when binary not found', async () => {
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    const cli = await WispCli.resolve();

    expect(cli).toBeNull();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Wisp binary not found. Install it?',
      'Install',
    );
  });

  it('opens install URL when user clicks Install button', async () => {
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(new Error('not found'), '', '');
      return {} as cp.ChildProcess;
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Install');

    await WispCli.resolve();

    expect(vscode.env.openExternal).toHaveBeenCalled();
  });

  it('uses where on win32 platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, 'C:\\Users\\user\\wisp.exe\n', '');
      return {} as cp.ChildProcess;
    });

    await WispCli.resolve();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringMatching(/^where /),
      expect.any(Function),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('uses which on non-win32 platforms', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    await WispCli.resolve();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringMatching(/^which /),
      expect.any(Function),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

describe('WispCli cancel() and isRunning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('/usr/local/bin/wisp'),
    });
  });

  it('isRunning returns false before run() is called', async () => {
    const cli = await WispCli.resolve();
    expect(cli).not.toBeNull();
    expect(cli!.isRunning).toBe(false);
  });

  it('cancel() is a noop when not running', async () => {
    const cli = await WispCli.resolve();
    expect(() => cli!.cancel()).not.toThrow();
  });

  it('cancel() sends SIGTERM and sets isRunning to false', async () => {
    const killMock = jest.fn();
    let closeCallback: ((code: number | null) => void) | undefined;

    jest.spyOn(cp, 'spawn').mockReturnValue({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      on: jest.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') {
          closeCallback = cb;
        }
      }),
      kill: killMock,
    } as unknown as cp.ChildProcess);

    const cli = await WispCli.resolve();
    expect(cli).not.toBeNull();

    // Start run but don't await — process stays open
    const runPromise = cli!.run(['orchestrate'], '/tmp', jest.fn(), jest.fn());

    expect(cli!.isRunning).toBe(true);
    cli!.cancel();
    expect(killMock).toHaveBeenCalledWith('SIGTERM');
    expect(cli!.isRunning).toBe(false);

    // Resolve the promise so the test doesn't hang
    closeCallback?.(0);
    await runPromise;
  });
});

describe('package.json activationEvents', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as { activationEvents: string[] };

  it('activates on wisp.* commands', () => {
    expect(pkg.activationEvents).toContain('onCommand:wisp.*');
  });

  it('activates when manifests directory contains JSON files', () => {
    expect(pkg.activationEvents).toContain('workspaceContains:**/manifests/*.json');
  });

  it('activates when prds directory contains markdown files', () => {
    expect(pkg.activationEvents).toContain('workspaceContains:**/prds/**/*.md');
  });
});

describe('package.json contributes.commands', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as { contributes: { commands: { command: string; title: string }[] } };

  const commandIds = pkg.contributes.commands.map((c) => c.command);

  const requiredCommands = [
    'wisp.orchestrate',
    'wisp.pipeline',
    'wisp.run',
    'wisp.generatePrd',
    'wisp.generateContext',
    'wisp.monitor',
    'wisp.installSkills',
    'wisp.update',
    'wisp.stopPipeline',
    'wisp.showOutput',
    'wisp.showVersion',
  ];

  it.each(requiredCommands)('declares %s in contributes.commands', (id) => {
    expect(commandIds).toContain(id);
  });

  it('all declared commands have a non-empty title', () => {
    for (const entry of pkg.contributes.commands) {
      expect(entry.title).toBeTruthy();
    }
  });
});
