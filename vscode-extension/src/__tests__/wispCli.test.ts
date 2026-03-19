import * as cp from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
