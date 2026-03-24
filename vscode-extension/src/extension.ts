import * as vscode from 'vscode';
import { WispCli } from './wispCli';
import { WispStatusBar } from './statusBar';
import { registerOrchestrateCommand } from './commands/orchestrate';
import { registerPipelineCommand } from './commands/pipeline';
import { registerRunCommand } from './commands/run';
import { registerGeneratePrdCommand, registerGenerateContextCommand, promptGeneratePrdArgs } from './commands/generate';
import { registerMonitorCommand } from './commands/monitor';
import { registerInstallSkillsCommand, registerUpdateCommand, runWithOutput } from './commands/utils';
import { WispTreeDataProvider } from './treeView/provider';
import { WispFileWatcher } from './treeView/watcher';
import { ManifestItem, EpicItem, SubtaskItem, PrdFileItem } from './treeView/items';

let outputChannel: vscode.OutputChannel | undefined;
let statusBar: WispStatusBar | undefined;
let activeCli: WispCli | null = null;
let fileWatcher: WispFileWatcher | undefined;

function onActivate(cli: WispCli): void {
  activeCli = cli;
}

function onDone(): void {
  activeCli = null;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Wisp AI');
  context.subscriptions.push(outputChannel);

  statusBar = new WispStatusBar();
  context.subscriptions.push(statusBar);

  const showVersion = vscode.commands.registerCommand('wisp.showVersion', async () => {
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    const result = await cli.runCapture(['--version'], process.cwd());
    const version = result.stdout.trim() || result.stderr.trim();
    vscode.window.showInformationMessage(`Wisp AI · wisp ${version}`);
  });
  context.subscriptions.push(showVersion);

  const showOutput = vscode.commands.registerCommand('wisp.showOutput', () => {
    outputChannel?.show();
  });
  context.subscriptions.push(showOutput);

  const stopPipeline = vscode.commands.registerCommand('wisp.stopPipeline', () => {
    if (activeCli) {
      activeCli.cancel();
      activeCli = null;
      statusBar?.setIdle();
      vscode.window.showInformationMessage('Wisp AI: Pipeline stopped.');
    } else {
      vscode.window.showInformationMessage('Wisp AI: No pipeline is currently running.');
    }
  });
  context.subscriptions.push(stopPipeline);

  registerOrchestrateCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerPipelineCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerRunCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerGeneratePrdCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerGenerateContextCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerMonitorCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerInstallSkillsCommand(context, outputChannel, statusBar, onActivate, onDone);
  registerUpdateCommand(context, outputChannel, statusBar, onActivate, onDone);

  // Tree view
  const treeProvider = new WispTreeDataProvider();
  const treeView = vscode.window.createTreeView('wispExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  fileWatcher = new WispFileWatcher(() => treeProvider.refresh());
  context.subscriptions.push(fileWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.explorer.refresh', () => {
      treeProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.explorer.openFile', async (fsPath: string) => {
      const doc = await vscode.workspace.openTextDocument(fsPath);
      await vscode.window.showTextDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.explorer.orchestrate', async (item: ManifestItem) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
        return;
      }
      const cli = await WispCli.resolve();
      if (!cli) {
        return;
      }
      const rawIterations = await vscode.window.showInputBox({
        prompt: 'Max iterations per agent',
        value: '2',
        validateInput: (val) =>
          /^\d+$/.test(val) && parseInt(val, 10) > 0
            ? undefined
            : 'Must be a positive integer',
      });
      if (rawIterations === undefined) {
        return;
      }
      const maxIterations = rawIterations || '2';
      await runWithOutput(
        cli,
        ['orchestrate', '--manifest', item.fsPath, '--max-iterations', maxIterations],
        cwd,
        outputChannel!,
        statusBar!,
        onActivate,
        onDone,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'wisp.explorer.orchestrateEpic',
      async (item: EpicItem) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        await runWithOutput(
          cli,
          ['orchestrate', '--manifest', item.manifestFsPath, '--epic', item.epicName],
          cwd,
          outputChannel!,
          statusBar!,
          onActivate,
          onDone,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'wisp.explorer.runPipeline',
      async (item: SubtaskItem) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        const rawIterations = await vscode.window.showInputBox({
          prompt: 'Max iterations per agent',
          value: '2',
          validateInput: (val) =>
            /^\d+$/.test(val) && parseInt(val, 10) > 0
              ? undefined
              : 'Must be a positive integer',
        });
        if (rawIterations === undefined) {
          return;
        }
        const maxIterations = rawIterations || '2';
        await runWithOutput(
          cli,
          ['pipeline', '--prd', item.prdPath, '--repo', item.repoUrl, '--branch', item.branch || 'main', '--max-iterations', maxIterations],
          cwd,
          outputChannel!,
          statusBar!,
          onActivate,
          onDone,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'wisp.explorer.runPipelineFromPrd',
      async (item: PrdFileItem) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
          return;
        }
        const repoUrl = await vscode.window.showInputBox({
          prompt: 'Repository URL',
          placeHolder: 'https://github.com/org/repo.git',
          validateInput: (val) =>
            val.startsWith('https://') || val.startsWith('git@')
              ? undefined
              : 'Must start with https:// or git@',
        });
        if (!repoUrl) {
          return;
        }
        const branch = await vscode.window.showInputBox({
          prompt: 'Branch',
          value: 'main',
        });
        if (branch === undefined) {
          return;
        }
        const contextPath = await vscode.window.showInputBox({
          prompt: 'Context path (optional, press Enter to skip)',
          value: '',
        });
        if (contextPath === undefined) {
          return;
        }
        const rawIterations = await vscode.window.showInputBox({
          prompt: 'Max iterations per agent',
          value: '2',
          validateInput: (val) =>
            /^\d+$/.test(val) && parseInt(val, 10) > 0
              ? undefined
              : 'Must be a positive integer',
        });
        if (rawIterations === undefined) {
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        const maxIterations = rawIterations || '2';
        const args = [
          'pipeline',
          '--prd',
          item.fsPath,
          '--repo',
          repoUrl,
          '--branch',
          branch || 'main',
          '--max-iterations',
          maxIterations,
        ];
        if (contextPath) {
          args.push('--context', contextPath);
        }
        await runWithOutput(cli, args, cwd, outputChannel!, statusBar!, onActivate, onDone);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'wisp.explorer.generatePrd',
      async (item: ManifestItem) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
          return;
        }
        const args = await promptGeneratePrdArgs(cwd, item.fsPath);
        if (!args) {
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        await runWithOutput(cli, args, cwd, outputChannel!, statusBar!, onActivate, onDone);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.explorer.generateContext', async () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
        return;
      }
      const repoUrl = await vscode.window.showInputBox({
        prompt: 'Repository URL',
        placeHolder: 'https://github.com/org/repo.git',
        validateInput: (val) =>
          val.startsWith('https://') || val.startsWith('git@')
            ? undefined
            : 'Must start with https:// or git@',
      });
      if (!repoUrl) {
        return;
      }
      const branch = await vscode.window.showInputBox({
        prompt: 'Branch to analyze',
        value: 'main',
      });
      if (branch === undefined) {
        return;
      }
      const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
      const output = await vscode.window.showInputBox({
        prompt: 'Output directory for context skills',
        value: `./contexts/${repoName}`,
        validateInput: (val) => (val.trim() ? undefined : 'Output directory is required'),
      });
      if (output === undefined) {
        return;
      }
      const cli = await WispCli.resolve();
      if (!cli) {
        return;
      }
      await runWithOutput(
        cli,
        ['generate', 'context', '--repo', repoUrl, '--branch', branch || 'main', '--output', output],
        cwd,
        outputChannel!,
        statusBar!,
        onActivate,
        onDone,
      );
    }),
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  activeCli = null;
  fileWatcher?.dispose();
  fileWatcher = undefined;
}
