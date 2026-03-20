import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { CommandHandlers } from '../commands';
import { WispCli } from '../wispCli';

// Mock WispCli and config module
jest.mock('../wispCli');
jest.mock('../config', () => ({
  resolveEnv: jest.fn().mockResolvedValue({}),
  resolveWispRoot: jest.fn().mockReturnValue(undefined),
}));

function makeMockCli(overrides: Partial<WispCli> = {}): WispCli {
  return {
    run: jest.fn().mockResolvedValue(0),
    runCapture: jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
    write: jest.fn(),
    ...overrides,
  } as unknown as WispCli;
}

function makeHandlers(cli: WispCli | null, outputChannel?: vscode.OutputChannel) {
  const channel = outputChannel ?? {
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  } as unknown as vscode.OutputChannel;
  const cliFactory = jest.fn().mockResolvedValue(cli);
  return { handlers: new CommandHandlers(cliFactory, channel), cliFactory, channel };
}

describe('CommandHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.workspaceFolders as unknown) = undefined;
  });

  describe('showVersion()', () => {
    it('shows version from stdout', async () => {
      const cli = makeMockCli({ runCapture: jest.fn().mockResolvedValue({ stdout: 'wisp 1.2.3\n', stderr: '', code: 0 }) } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.showVersion();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Wisp version: wisp 1.2.3');
    });

    it('falls back to stderr when stdout is empty', async () => {
      const cli = makeMockCli({ runCapture: jest.fn().mockResolvedValue({ stdout: '', stderr: '1.0.0\n', code: 0 }) } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.showVersion();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Wisp version: 1.0.0');
    });

    it('shows error when cli not found', async () => {
      const { handlers } = makeHandlers(null);

      await handlers.showVersion();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Wisp binary not found'),
      );
    });
  });

  describe('orchestrate()', () => {
    it('uses provided URI without prompting', async () => {
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);
      const uri = { fsPath: '/workspace/manifests/my.json' } as vscode.Uri;

      await handlers.orchestrate(uri);

      expect(cli.run).toHaveBeenCalledWith(
        ['orchestrate', '--manifest', '/workspace/manifests/my.json'],
        expect.any(String),
        expect.any(Function),
        expect.any(Function),
        expect.objectContaining({ cancellationToken: expect.anything() }),
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('prompts for manifest when no URI provided', async () => {
      const uri = { fsPath: '/workspace/manifests/my.json', toString: () => '' };
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
      (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('manifests/my.json');
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
        label: 'manifests/my.json',
        uri,
      });
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.orchestrate();

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(cli.run).toHaveBeenCalled();
    });

    it('returns early when user dismisses manifest picker', async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        { fsPath: '/workspace/manifests/my.json' },
      ]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.orchestrate();

      expect(cli.run).not.toHaveBeenCalled();
    });

    it('shows error when no manifests found', async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.orchestrate();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('No manifest files found'),
      );
      expect(cli.run).not.toHaveBeenCalled();
    });
  });

  describe('pipeline()', () => {
    it('prompts for PRD path and repo URL then runs pipeline', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('prds/my.md')
        .mockResolvedValueOnce('https://github.com/org/repo');
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.pipeline();

      expect(cli.run).toHaveBeenCalledWith(
        ['pipeline', '--prd', 'prds/my.md', '--repo', 'https://github.com/org/repo'],
        expect.any(String),
        expect.any(Function),
        expect.any(Function),
        expect.anything(),
      );
    });

    it('returns early when PRD path is dismissed', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.pipeline();

      expect(cli.run).not.toHaveBeenCalled();
    });

    it('returns early when repo URL is dismissed', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('prds/my.md')
        .mockResolvedValueOnce(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.pipeline();

      expect(cli.run).not.toHaveBeenCalled();
    });
  });

  describe('run()', () => {
    it('prompts for agent, workdir, prd and runs correct args', async () => {
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'developer' });
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('/tmp/work')
        .mockResolvedValueOnce('prds/feat.md');
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.run();

      expect(cli.run).toHaveBeenCalledWith(
        ['run', '--agent', 'developer', '--workdir', '/tmp/work', '--prd', 'prds/feat.md'],
        '/tmp/work',
        expect.any(Function),
        expect.any(Function),
        expect.anything(),
      );
    });

    it('returns early when agent picker is dismissed', async () => {
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.run();

      expect(cli.run).not.toHaveBeenCalled();
    });

    it('returns early when workdir input is dismissed', async () => {
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'developer' });
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.run();

      expect(cli.run).not.toHaveBeenCalled();
    });

    it('returns early when PRD path input is dismissed', async () => {
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'developer' });
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('/tmp/work')
        .mockResolvedValueOnce(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.run();

      expect(cli.run).not.toHaveBeenCalled();
    });
  });

  describe('generatePrd()', () => {
    it('passes description flag and opens result in editor', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue('my feature description');
      const cli = makeMockCli({
        runCapture: jest.fn().mockResolvedValue({ stdout: '# PRD\ncontent', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.generatePrd();

      expect(cli.runCapture).toHaveBeenCalledWith(
        ['generate', 'prd', '--description', 'my feature description'],
        expect.any(String),
        expect.objectContaining({ env: expect.anything() }),
      );
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
        content: '# PRD\ncontent',
        language: 'markdown',
      });
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });

    it('shows error when generation fails', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue('my feature');
      const cli = makeMockCli({
        runCapture: jest.fn().mockResolvedValue({ stdout: '', stderr: 'error msg', code: 1 }),
      } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.generatePrd();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate PRD'),
      );
    });
  });

  describe('generateContext()', () => {
    it('prompts for repo URL and runs generate context', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue('https://github.com/org/repo');
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.generateContext();

      expect(cli.run).toHaveBeenCalledWith(
        ['generate', 'context', '--repo', 'https://github.com/org/repo'],
        expect.any(String),
        expect.any(Function),
        expect.any(Function),
        expect.anything(),
      );
    });

    it('returns early when repo URL is dismissed', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.generateContext();

      expect(cli.run).not.toHaveBeenCalled();
    });

    it('shows success notification after context generation', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue('https://github.com/org/repo');
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.generateContext();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Context generated in contexts/',
      );
    });
  });

  describe('monitor()', () => {
    it('prompts for workdir and streams monitor command', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue('/tmp/work');
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.monitor();

      expect(cli.run).toHaveBeenCalledWith(
        ['monitor', '--workdir', '/tmp/work'],
        '/tmp/work',
        expect.any(Function),
        expect.any(Function),
        expect.anything(),
      );
    });

    it('returns early when workdir is dismissed', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.monitor();

      expect(cli.run).not.toHaveBeenCalled();
    });
  });

  describe('installSkills()', () => {
    it('runs install skills and shows success notification', async () => {
      const cli = makeMockCli({
        runCapture: jest.fn().mockResolvedValue({ stdout: 'done', stderr: '', code: 0 }),
      } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.installSkills();

      expect(cli.runCapture).toHaveBeenCalledWith(
        ['install', 'skills'],
        expect.any(String),
        expect.objectContaining({ env: expect.anything() }),
      );
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Wisp skills installed successfully',
      );
    });

    it('shows error when install fails', async () => {
      const cli = makeMockCli({
        runCapture: jest.fn().mockResolvedValue({ stdout: '', stderr: 'permission denied', code: 1 }),
      } as Partial<WispCli>);
      const { handlers } = makeHandlers(cli);

      await handlers.installSkills();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to install skills'),
      );
    });
  });

  describe('cancellation', () => {
    it('passes cancellation token to cli.run()', async () => {
      const firedToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
      (vscode.window.withProgress as jest.Mock).mockImplementation(
        (_opts: unknown, task: (_p: unknown, token: unknown) => Promise<unknown>) =>
          task({}, firedToken),
      );
      const uri = { fsPath: '/workspace/manifests/my.json' } as vscode.Uri;
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      await handlers.orchestrate(uri);

      expect(cli.run).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(Function),
        expect.any(Function),
        expect.objectContaining({ cancellationToken: firedToken }),
      );
    });
  });

  describe('updateRoot()', () => {
    it('uses updated root for env resolution', async () => {
      const { resolveEnv } = jest.requireMock('../config') as { resolveEnv: jest.Mock };
      const cli = makeMockCli();
      const { handlers } = makeHandlers(cli);

      handlers.updateRoot('/my/custom/root');
      const uri = { fsPath: '/workspace/manifests/my.json' } as vscode.Uri;
      await handlers.orchestrate(uri);

      expect(resolveEnv).toHaveBeenCalledWith('/my/custom/root');
    });
  });
});

describe('package.json commands', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as {
    contributes: {
      commands: Array<{ command: string; category?: string }>;
      viewsContainers: { activitybar: Array<{ id: string; title: string }> };
      views: Record<string, Array<{ id: string; name: string }>>;
      menus: Record<string, unknown[]>;
      submenus: Array<{ id: string; label: string }>;
    };
  };

  const expectedCommands = [
    'wisp.showVersion',
    'wisp.orchestrate',
    'wisp.pipeline',
    'wisp.run',
    'wisp.generatePrd',
    'wisp.generateContext',
    'wisp.monitor',
    'wisp.installSkills',
    'wisp.openChatPanel',
  ];

  it.each(expectedCommands)('registers command %s in package.json', (cmd) => {
    const ids = pkg.contributes.commands.map((c) => c.command);
    expect(ids).toContain(cmd);
  });

  it.each(expectedCommands)('command %s has "Wisp" category', (cmd) => {
    const entry = pkg.contributes.commands.find((c) => c.command === cmd);
    expect(entry?.category).toBe('Wisp');
  });

  it('registers wispSidebar activity bar container', () => {
    const ids = pkg.contributes.viewsContainers.activitybar.map((c) => c.id);
    expect(ids).toContain('wispSidebar');
  });

  it('registers wispManifests view in sidebar', () => {
    const views = pkg.contributes.views['wispSidebar'] ?? [];
    const ids = views.map((v) => v.id);
    expect(ids).toContain('wispManifests');
  });

  it('registers wispPrds view in sidebar', () => {
    const views = pkg.contributes.views['wispSidebar'] ?? [];
    const ids = views.map((v) => v.id);
    expect(ids).toContain('wispPrds');
  });

  it('registers explorer/context menu entries', () => {
    expect(pkg.contributes.menus['explorer/context']).toBeDefined();
    expect((pkg.contributes.menus['explorer/context'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('registers wisp.submenu in submenus', () => {
    const ids = pkg.contributes.submenus.map((s) => s.id);
    expect(ids).toContain('wisp.submenu');
  });

  it('registers view/item/context menu for manifest inline run button', () => {
    const items = pkg.contributes.menus['view/item/context'] as Array<{ command: string; when: string; group: string }>;
    const inlineItem = items?.find((i) => i.command === 'wisp.orchestrate' && i.group === 'inline');
    expect(inlineItem).toBeDefined();
    expect(inlineItem?.when).toContain('wispManifests');
    expect(inlineItem?.when).toContain('manifestFile');
  });
});

describe('package.json wisp.* settings', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as {
    contributes: {
      configuration: {
        properties: Record<string, { type: string; scope?: string; enum?: string[] }>;
      };
    };
  };

  const expectedSettings = [
    'wisp.binaryPath',
    'wisp.rootFolder',
    'wisp.provider',
    'wisp.maxParallel',
    'wisp.maxIterations',
    'wisp.baseBranch',
    'wisp.workDir',
    'wisp.useDevcontainer',
    'wisp.skipPr',
    'wisp.interactive',
    'wisp.logDir',
    'wisp.verbose',
    'wisp.evidenceAgents',
    'wisp.claudeModel',
    'wisp.geminiModel',
  ];

  it.each(expectedSettings)('registers setting %s in package.json', (setting) => {
    expect(pkg.contributes.configuration.properties[setting]).toBeDefined();
  });

  it('wisp.binaryPath has machine-overridable scope', () => {
    expect(pkg.contributes.configuration.properties['wisp.binaryPath'].scope).toBe('machine-overridable');
  });

  it('wisp.provider is an enum with claude and gemini', () => {
    const prop = pkg.contributes.configuration.properties['wisp.provider'];
    expect(prop.enum).toContain('claude');
    expect(prop.enum).toContain('gemini');
  });

  it('auth token settings are NOT present', () => {
    const keys = Object.keys(pkg.contributes.configuration.properties);
    expect(keys).not.toContain('wisp.anthropicApiKey');
    expect(keys).not.toContain('wisp.githubToken');
    expect(keys).not.toContain('wisp.geminiApiKey');
  });
});
