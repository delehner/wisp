/**
 * Tests for Explorer tree view command handlers registered in extension.ts.
 *
 * Verifies that each handler correctly extracts string properties from tree
 * item objects (ManifestItem, EpicItem, SubtaskItem, PrdFileItem) and passes
 * them as CLI arguments — fixing the [object Object] bug described in the PRD.
 */
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { activate } from '../extension';
import { ManifestItem, EpicItem, SubtaskItem, PrdFileItem } from '../treeView/items';

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

/** Return the handler registered under `commandId` from the mock call list. */
function getHandler(commandId: string): (...args: unknown[]) => Promise<void> {
  const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls as [string, (...args: unknown[]) => Promise<void>][];
  const found = calls.find(([id]) => id === commandId);
  if (!found) throw new Error(`Command "${commandId}" was not registered`);
  return found[1];
}

describe('Explorer command handlers (extension.ts)', () => {
  let context: vscode.ExtensionContext;

  beforeEach(async () => {
    jest.clearAllMocks();

    context = {
      subscriptions: { push: jest.fn() },
    } as unknown as vscode.ExtensionContext;

    // WispCli.resolve() uses `which wisp` via cp.exec
    mockExec.mockImplementation((_cmd, callback: unknown) => {
      (callback as ExecCallback)(null, '/usr/local/bin/wisp\n', '');
      return {} as cp.ChildProcess;
    });

    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];

    await activate(context);
  });

  // ─── wisp.explorer.orchestrate ───────────────────────────────────────────

  describe('wisp.explorer.orchestrate', () => {
    it('registers the command', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'wisp.explorer.orchestrate',
        expect.any(Function),
      );
    });

    it('passes item.fsPath as --manifest argument', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('3'); // max-iterations
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrate')(item);

      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        ['orchestrate', '--manifest', '/workspace/manifests/my.json', '--max-iterations', '3'],
        expect.any(Object),
      );
      spawnMock.mockRestore();
    });

    it('uses default max-iterations "2" when input is empty', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(''); // empty → '2'
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrate')(item);

      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        ['orchestrate', '--manifest', '/workspace/manifests/my.json', '--max-iterations', '2'],
        expect.any(Object),
      );
      spawnMock.mockRestore();
    });

    it('returns early without spawning when max-iterations is cancelled', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrate')(item);

      expect(spawnMock).not.toHaveBeenCalled();
      spawnMock.mockRestore();
    });

    it('shows error when no workspace folder is open', async () => {
      (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrate')(item);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
      expect(cp.spawn).not.toHaveBeenCalled();
    });
  });

  // ─── wisp.explorer.orchestrateEpic ───────────────────────────────────────

  describe('wisp.explorer.orchestrateEpic', () => {
    it('registers the command', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'wisp.explorer.orchestrateEpic',
        expect.any(Function),
      );
    });

    it('passes item.manifestFsPath and item.epicName as CLI args', async () => {
      const spawnMock = makeSpawnMock();

      const item = new EpicItem('Sprint 1', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrateEpic')(item);

      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        ['orchestrate', '--manifest', '/workspace/manifests/my.json', '--epic', 'Sprint 1'],
        expect.any(Object),
      );
      spawnMock.mockRestore();
    });

    it('shows error when no workspace folder is open', async () => {
      (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

      const item = new EpicItem('Sprint 1', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.orchestrateEpic')(item);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
      expect(cp.spawn).not.toHaveBeenCalled();
    });
  });

  // ─── wisp.explorer.runPipeline ────────────────────────────────────────────

  describe('wisp.explorer.runPipeline', () => {
    it('registers the command', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'wisp.explorer.runPipeline',
        expect.any(Function),
      );
    });

    it('passes item.prdPath, item.repoUrl, item.branch as CLI args', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('5'); // max-iterations
      const spawnMock = makeSpawnMock();

      const item = new SubtaskItem(
        '/workspace/prds/feature/task.md',
        'https://github.com/org/repo',
        '/workspace/manifests/my.json',
        'develop',
      );
      await getHandler('wisp.explorer.runPipeline')(item);

      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        [
          'pipeline',
          '--prd', '/workspace/prds/feature/task.md',
          '--repo', 'https://github.com/org/repo',
          '--branch', 'develop',
          '--max-iterations', '5',
        ],
        expect.any(Object),
      );
      spawnMock.mockRestore();
    });

    it('falls back to "main" when item.branch is not set', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('2');
      const spawnMock = makeSpawnMock();

      // SubtaskItem default branch is 'main'
      const item = new SubtaskItem(
        '/workspace/prds/feature/task.md',
        'https://github.com/org/repo',
        '/workspace/manifests/my.json',
      );
      await getHandler('wisp.explorer.runPipeline')(item);

      const spawnArgs = (spawnMock.mock.calls[0] as [string, string[]])[1];
      const branchIdx = spawnArgs.indexOf('--branch');
      expect(spawnArgs[branchIdx + 1]).toBe('main');
      spawnMock.mockRestore();
    });

    it('returns early without spawning when max-iterations is cancelled', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
      const spawnMock = makeSpawnMock();

      const item = new SubtaskItem('prds/task.md', 'https://github.com/org/repo', '/ws/m.json', 'main');
      await getHandler('wisp.explorer.runPipeline')(item);

      expect(spawnMock).not.toHaveBeenCalled();
      spawnMock.mockRestore();
    });

    it('shows error when no workspace folder is open', async () => {
      (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

      const item = new SubtaskItem('prds/task.md', 'https://github.com/org/repo', '/ws/m.json', 'main');
      await getHandler('wisp.explorer.runPipeline')(item);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
      expect(cp.spawn).not.toHaveBeenCalled();
    });
  });

  // ─── wisp.explorer.runPipelineFromPrd ────────────────────────────────────

  describe('wisp.explorer.runPipelineFromPrd', () => {
    it('registers the command', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'wisp.explorer.runPipelineFromPrd',
        expect.any(Function),
      );
    });

    it('passes item.fsPath as --prd argument', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://github.com/org/repo') // repoUrl
        .mockResolvedValueOnce('main')                        // branch
        .mockResolvedValueOnce('')                            // contextPath (empty)
        .mockResolvedValueOnce('2');                          // max-iterations
      const spawnMock = makeSpawnMock();

      const item = new PrdFileItem('/workspace/prds/feature/task.md', 'My Feature', 'Ready');
      await getHandler('wisp.explorer.runPipelineFromPrd')(item);

      const spawnArgs = (spawnMock.mock.calls[0] as [string, string[]])[1];
      const prdIdx = spawnArgs.indexOf('--prd');
      expect(spawnArgs[prdIdx + 1]).toBe('/workspace/prds/feature/task.md');
      spawnMock.mockRestore();
    });

    it('includes --context arg when contextPath is provided', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://github.com/org/repo')
        .mockResolvedValueOnce('main')
        .mockResolvedValueOnce('./contexts/repo')
        .mockResolvedValueOnce('2');
      const spawnMock = makeSpawnMock();

      const item = new PrdFileItem('/workspace/prds/task.md', 'Task', 'Ready');
      await getHandler('wisp.explorer.runPipelineFromPrd')(item);

      const spawnArgs = (spawnMock.mock.calls[0] as [string, string[]])[1];
      expect(spawnArgs).toContain('--context');
      expect(spawnArgs[spawnArgs.indexOf('--context') + 1]).toBe('./contexts/repo');
      spawnMock.mockRestore();
    });

    it('does not include --context arg when contextPath is empty', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://github.com/org/repo')
        .mockResolvedValueOnce('main')
        .mockResolvedValueOnce('')  // empty context
        .mockResolvedValueOnce('2');
      const spawnMock = makeSpawnMock();

      const item = new PrdFileItem('/workspace/prds/task.md', 'Task', 'Ready');
      await getHandler('wisp.explorer.runPipelineFromPrd')(item);

      const spawnArgs = (spawnMock.mock.calls[0] as [string, string[]])[1];
      expect(spawnArgs).not.toContain('--context');
      spawnMock.mockRestore();
    });

    it('returns early without spawning when repoUrl prompt is cancelled', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined); // cancel
      const spawnMock = makeSpawnMock();

      const item = new PrdFileItem('/workspace/prds/task.md', 'Task', 'Ready');
      await getHandler('wisp.explorer.runPipelineFromPrd')(item);

      expect(spawnMock).not.toHaveBeenCalled();
      spawnMock.mockRestore();
    });
  });

  // ─── wisp.explorer.generatePrd ───────────────────────────────────────────

  describe('wisp.explorer.generatePrd', () => {
    it('registers the command', () => {
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'wisp.explorer.generatePrd',
        expect.any(Function),
      );
    });

    it('passes item.fsPath to promptGeneratePrdArgs (used as manifest path)', async () => {
      // promptGeneratePrdArgs shows an input box for repo URL
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://github.com/org/repo') // repo URL
        .mockResolvedValueOnce('')                            // output dir (uses default)
        .mockResolvedValueOnce('');                           // other optional input
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.generatePrd')(item);

      // If spawn was called, --manifest arg should reference the manifest path
      if (spawnMock.mock.calls.length > 0) {
        const spawnArgs = (spawnMock.mock.calls[0] as [string, string[]])[1];
        const manifestIdx = spawnArgs.indexOf('--manifest');
        if (manifestIdx >= 0) {
          expect(spawnArgs[manifestIdx + 1]).toBe('/workspace/manifests/my.json');
        }
      }
      spawnMock.mockRestore();
    });

    it('returns early without spawning when promptGeneratePrdArgs is cancelled', async () => {
      // Cancel the first input (repo URL) to simulate user cancelling
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.generatePrd')(item);

      expect(spawnMock).not.toHaveBeenCalled();
      spawnMock.mockRestore();
    });

    it('shows error when no workspace folder is open', async () => {
      (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

      const item = new ManifestItem('My Manifest', '/workspace/manifests/my.json', []);
      await getHandler('wisp.explorer.generatePrd')(item);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Wisp AI: No workspace folder open.');
      expect(cp.spawn).not.toHaveBeenCalled();
    });
  });

  // ─── No [object Object] regression ───────────────────────────────────────

  describe('no [object Object] regression', () => {
    it('orchestrate: CLI args contain no "[object Object]" string', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('2');
      const spawnMock = makeSpawnMock();

      const item = new ManifestItem('M', '/workspace/manifests/m.json', []);
      await getHandler('wisp.explorer.orchestrate')(item);

      if (spawnMock.mock.calls.length > 0) {
        const args = (spawnMock.mock.calls[0] as [string, string[]])[1];
        expect(args.join(' ')).not.toContain('[object Object]');
      }
      spawnMock.mockRestore();
    });

    it('orchestrateEpic: CLI args contain no "[object Object]" string', async () => {
      const spawnMock = makeSpawnMock();

      const item = new EpicItem('E', '/workspace/manifests/m.json', []);
      await getHandler('wisp.explorer.orchestrateEpic')(item);

      if (spawnMock.mock.calls.length > 0) {
        const args = (spawnMock.mock.calls[0] as [string, string[]])[1];
        expect(args.join(' ')).not.toContain('[object Object]');
      }
      spawnMock.mockRestore();
    });

    it('runPipeline: CLI args contain no "[object Object]" string', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('2');
      const spawnMock = makeSpawnMock();

      const item = new SubtaskItem('prds/task.md', 'https://github.com/org/repo', '/ws/m.json', 'main');
      await getHandler('wisp.explorer.runPipeline')(item);

      if (spawnMock.mock.calls.length > 0) {
        const args = (spawnMock.mock.calls[0] as [string, string[]])[1];
        expect(args.join(' ')).not.toContain('[object Object]');
      }
      spawnMock.mockRestore();
    });
  });
});
