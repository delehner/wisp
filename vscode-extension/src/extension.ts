import * as vscode from 'vscode';
import { WispCli } from './wispCli';
import { WispStatusBar } from './statusBar';
import { registerOrchestrateCommand } from './commands/orchestrate';
import { registerPipelineCommand } from './commands/pipeline';
import { registerRunCommand } from './commands/run';
import { registerGeneratePrdCommand, registerGenerateContextCommand } from './commands/generate';
import { registerMonitorCommand } from './commands/monitor';
import { registerInstallSkillsCommand, registerUpdateCommand, runWithOutput } from './commands/utils';
import { WispTreeDataProvider } from './treeView/provider';
import { WispFileWatcher } from './treeView/watcher';

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
  outputChannel = vscode.window.createOutputChannel('Wisp');
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
    vscode.window.showInformationMessage(`Wisp version: ${version}`);
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
      vscode.window.showInformationMessage('Wisp: Pipeline stopped.');
    } else {
      vscode.window.showInformationMessage('Wisp: No pipeline is currently running.');
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
    vscode.commands.registerCommand('wisp.explorer.orchestrate', async (manifestPath: string) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        vscode.window.showErrorMessage('Wisp: No workspace folder open.');
        return;
      }
      const cli = await WispCli.resolve();
      if (!cli) {
        return;
      }
      await runWithOutput(
        cli,
        ['orchestrate', '--manifest', manifestPath],
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
      async (manifestPath: string, epicName: string) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp: No workspace folder open.');
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        await runWithOutput(
          cli,
          ['orchestrate', '--manifest', manifestPath, '--epic', epicName],
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
      async (prdPath: string, repoUrl: string) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showErrorMessage('Wisp: No workspace folder open.');
          return;
        }
        const cli = await WispCli.resolve();
        if (!cli) {
          return;
        }
        await runWithOutput(
          cli,
          ['pipeline', '--prd', prdPath, '--repo', repoUrl],
          cwd,
          outputChannel!,
          statusBar!,
          onActivate,
          onDone,
        );
      },
    ),
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
