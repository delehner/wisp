import * as vscode from 'vscode';
import { WispStatusBar } from '../statusBar';
import { WispCli } from '../wispCli';

jest.mock('../wispCli');

function makeMockCli(overrides: Partial<WispCli> = {}): WispCli {
  return {
    run: jest.fn().mockResolvedValue(0),
    runCapture: jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
    ...overrides,
  } as unknown as WispCli;
}

describe('WispStatusBar', () => {
  let mockStatusBarItem: {
    text: string;
    color: unknown;
    command: unknown;
    show: jest.Mock;
    dispose: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStatusBarItem = {
      text: '',
      color: undefined,
      command: undefined,
      show: jest.fn(),
      dispose: jest.fn(),
    };
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBarItem);
  });

  describe('constructor', () => {
    it('creates a Left-aligned status bar item', () => {
      const cliFactory = jest.fn();
      new WispStatusBar(cliFactory);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
        vscode.StatusBarAlignment.Left,
        100,
      );
    });

    it('sets command to open command palette pre-filtered to Wisp', () => {
      const cliFactory = jest.fn();
      new WispStatusBar(cliFactory);

      expect(mockStatusBarItem.command).toEqual({
        command: 'workbench.action.quickOpen',
        arguments: ['>Wisp '],
        title: '',
      });
    });

    it('shows the status bar item on creation', () => {
      const cliFactory = jest.fn();
      new WispStatusBar(cliFactory);

      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
  });

  describe('update()', () => {
    it('shows version text when CLI is found', async () => {
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.2.3\n', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp wisp 1.2.3');
      expect(mockStatusBarItem.color).toBeUndefined();
    });

    it('falls back to stderr when stdout is empty', async () => {
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: '', stderr: '2.0.0', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp 2.0.0');
    });

    it('uses only the first line of multi-line version output', async () => {
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.2.3\nextra line', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp wisp 1.2.3');
    });

    it('shows warning text when CLI is not found', async () => {
      const cliFactory = jest.fn().mockResolvedValue(null);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(warning) Wisp: not found');
      expect(mockStatusBarItem.color).toEqual(
        expect.objectContaining({ id: 'statusBarItem.warningForeground' }),
      );
    });

    it('shows warning text when runCapture throws', async () => {
      const cli = makeMockCli({
        runCapture: jest.fn().mockRejectedValue(new Error('spawn failed')),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(warning) Wisp: not found');
      expect(mockStatusBarItem.color).toEqual(
        expect.objectContaining({ id: 'statusBarItem.warningForeground' }),
      );
    });

    it('clears warning color after successful update', async () => {
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.0.0', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      // First set warning state
      mockStatusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');

      await bar.update();

      expect(mockStatusBarItem.color).toBeUndefined();
    });
  });

  describe('multi-root workspace', () => {
    afterEach(() => {
      (vscode.workspace.workspaceFolders as unknown) = undefined;
    });

    it('appends [folderName] when in multi-root workspace', async () => {
      (vscode.workspace.workspaceFolders as unknown) = [
        { name: 'frontend', uri: { fsPath: '/workspace/frontend' } },
        { name: 'backend', uri: { fsPath: '/workspace/backend' } },
      ];
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.2.3', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update('/workspace/backend');

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp wisp 1.2.3 [backend]');
    });

    it('does not append folder name in single-root workspace', async () => {
      (vscode.workspace.workspaceFolders as unknown) = [
        { name: 'myapp', uri: { fsPath: '/workspace/myapp' } },
      ];
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.2.3', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update('/workspace/myapp');

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp wisp 1.2.3');
    });

    it('does not append folder name when rootPath is undefined in multi-root', async () => {
      (vscode.workspace.workspaceFolders as unknown) = [
        { name: 'frontend', uri: { fsPath: '/workspace/frontend' } },
        { name: 'backend', uri: { fsPath: '/workspace/backend' } },
      ];
      const cli = makeMockCli({
        runCapture: jest
          .fn()
          .mockResolvedValue({ stdout: 'wisp 1.2.3', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const cliFactory = jest.fn().mockResolvedValue(cli);
      const bar = new WispStatusBar(cliFactory);

      await bar.update();

      expect(mockStatusBarItem.text).toBe('$(circuit-board) Wisp wisp 1.2.3');
    });
  });

  describe('dispose()', () => {
    it('disposes the status bar item', () => {
      const cliFactory = jest.fn();
      const bar = new WispStatusBar(cliFactory);

      bar.dispose();

      expect(mockStatusBarItem.dispose).toHaveBeenCalled();
    });
  });
});
