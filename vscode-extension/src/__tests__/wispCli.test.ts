import * as cp from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import { WispCli } from '../wispCli';

jest.mock('node:child_process');
const mockExec = cp.exec as jest.MockedFunction<typeof cp.exec>;
const mockSpawn = cp.spawn as jest.MockedFunction<typeof cp.spawn>;
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

describe('WispCli.run()', () => {
  let closeHandlers: Array<(code: number | null) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    closeHandlers = [];
  });

  function fireClose(code: number | null) {
    closeHandlers.forEach((h) => h(code));
  }

  function makeMockProc() {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const kill = jest.fn();
    const proc = {
      stdout,
      stderr,
      stdin: null,
      kill,
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandlers.push(cb as (code: number | null) => void);
      }),
    };
    mockSpawn.mockReturnValue(proc as unknown as cp.ChildProcess);
    return { stdout, stderr, kill };
  }

  function makeCliInstance(): WispCli {
    return new (WispCli as unknown as new (path: string) => WispCli)('/usr/bin/wisp');
  }

  it('sends SIGTERM to spawned process when cancellation token fires', async () => {
    const { stdout, stderr, kill } = makeMockProc();

    let onCancel: (() => void) | undefined;
    const token: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn((cb) => {
        onCancel = cb as () => void;
        return { dispose: jest.fn() };
      }),
    };

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn(), { cancellationToken: token });

    onCancel?.();
    expect(kill).toHaveBeenCalledWith('SIGTERM');

    stdout.end();
    stderr.end();
    fireClose(null);
    await runPromise;
  });

  it('disposes the cancellation subscription when process closes', async () => {
    const { stdout, stderr } = makeMockProc();
    const disposeSpy = jest.fn();

    const token: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: disposeSpy })),
    };

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn(), { cancellationToken: token });

    stdout.end();
    stderr.end();
    fireClose(0);
    await runPromise;

    expect(disposeSpy).toHaveBeenCalled();
  });

  it('resolves with the exit code from the process', async () => {
    const { stdout, stderr } = makeMockProc();

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn());

    stdout.end();
    stderr.end();
    fireClose(42);
    const code = await runPromise;

    expect(code).toBe(42);
  });

  it('resolves with 1 when process exits with null code', async () => {
    const { stdout, stderr } = makeMockProc();

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn());

    stdout.end();
    stderr.end();
    fireClose(null);
    const code = await runPromise;

    expect(code).toBe(1);
  });

  it('calls onStdout callback for each stdout line', async () => {
    const { stdout, stderr } = makeMockProc();
    const onStdout = jest.fn();

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', onStdout, jest.fn());

    stdout.write('hello\n');
    stdout.write('world\n');
    stdout.end();
    stderr.end();
    fireClose(0);
    await runPromise;

    expect(onStdout).toHaveBeenCalledWith('hello');
    expect(onStdout).toHaveBeenCalledWith('world');
  });

  it('calls onStderr callback for each stderr line', async () => {
    const { stdout, stderr } = makeMockProc();
    const onStderr = jest.fn();

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), onStderr);

    stderr.write('error line\n');
    stdout.end();
    stderr.end();
    fireClose(1);
    await runPromise;

    expect(onStderr).toHaveBeenCalledWith('error line');
  });
});

describe('WispCli.write()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeCliInstance(): WispCli {
    return new (WispCli as unknown as new (path: string) => WispCli)('/usr/bin/wisp');
  }

  it('does not throw when called before any run() (proc is undefined)', () => {
    const cli = makeCliInstance();
    expect(() => cli.write('s\n')).not.toThrow();
  });

  it('does not throw when proc has no stdin (stdin is null)', async () => {
    let closeHandlers: Array<(code: number | null) => void> = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = {
      stdout,
      stderr,
      stdin: null,
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandlers.push(cb as (code: number | null) => void);
      }),
    };
    mockSpawn.mockReturnValue(proc as unknown as cp.ChildProcess);

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn());

    expect(() => cli.write('s\n')).not.toThrow();

    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));
    await runPromise;
  });

  it('calls stdin.write with data when proc has a writable stdin', async () => {
    const stdinWrite = jest.fn();
    let closeHandlers: Array<(code: number | null) => void> = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = {
      stdout,
      stderr,
      stdin: { write: stdinWrite },
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandlers.push(cb as (code: number | null) => void);
      }),
    };
    mockSpawn.mockReturnValue(proc as unknown as cp.ChildProcess);

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn());

    cli.write('s\n');

    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));
    await runPromise;

    expect(stdinWrite).toHaveBeenCalledWith('s\n');
  });

  it('can write multiple commands sequentially', async () => {
    const stdinWrite = jest.fn();
    let closeHandlers: Array<(code: number | null) => void> = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = {
      stdout,
      stderr,
      stdin: { write: stdinWrite },
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandlers.push(cb as (code: number | null) => void);
      }),
    };
    mockSpawn.mockReturnValue(proc as unknown as cp.ChildProcess);

    const cli = makeCliInstance();
    const runPromise = cli.run(['test'], '/tmp', jest.fn(), jest.fn());

    cli.write('s\n');
    cli.write('c\n');
    cli.write('q\n');

    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));
    await runPromise;

    expect(stdinWrite).toHaveBeenCalledTimes(3);
    expect(stdinWrite).toHaveBeenNthCalledWith(1, 's\n');
    expect(stdinWrite).toHaveBeenNthCalledWith(2, 'c\n');
    expect(stdinWrite).toHaveBeenNthCalledWith(3, 'q\n');
  });
});

describe('WispCli.runCapture()', () => {
  let closeHandlers: Array<(code: number | null) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    closeHandlers = [];
  });

  function makeMockProc() {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = {
      stdout,
      stderr,
      stdin: null,
      kill: jest.fn(),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandlers.push(cb as (code: number | null) => void);
      }),
    };
    mockSpawn.mockReturnValue(proc as unknown as cp.ChildProcess);
    return { stdout, stderr };
  }

  function makeCliInstance(): WispCli {
    return new (WispCli as unknown as new (path: string) => WispCli)('/usr/bin/wisp');
  }

  it('collects stdout and stderr lines into a CaptureResult', async () => {
    const { stdout, stderr } = makeMockProc();
    const cli = makeCliInstance();
    const capturePromise = cli.runCapture(['--version'], '/tmp');

    stdout.write('wisp 1.2.3\n');
    stderr.write('warning: something\n');
    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));

    const result = await capturePromise;

    expect(result.stdout).toBe('wisp 1.2.3');
    expect(result.stderr).toBe('warning: something');
    expect(result.code).toBe(0);
  });

  it('returns non-zero exit code on failure', async () => {
    const { stdout, stderr } = makeMockProc();
    const cli = makeCliInstance();
    const capturePromise = cli.runCapture(['test'], '/tmp');

    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(2));

    const result = await capturePromise;
    expect(result.code).toBe(2);
  });

  it('joins multiple stdout lines with newline separator', async () => {
    const { stdout, stderr } = makeMockProc();
    const cli = makeCliInstance();
    const capturePromise = cli.runCapture(['test'], '/tmp');

    stdout.write('line1\nline2\nline3\n');
    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));

    const result = await capturePromise;
    expect(result.stdout).toBe('line1\nline2\nline3');
  });

  it('returns empty stdout and stderr when process produces no output', async () => {
    const { stdout, stderr } = makeMockProc();
    const cli = makeCliInstance();
    const capturePromise = cli.runCapture(['test'], '/tmp');

    stdout.end();
    stderr.end();
    closeHandlers.forEach((h) => h(0));

    const result = await capturePromise;
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
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
