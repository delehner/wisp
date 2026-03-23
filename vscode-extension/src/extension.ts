import * as vscode from 'vscode';
import { WispCli } from './wispCli';
import { WispStatusBar } from './statusBar';
import { registerOrchestrateCommand } from './commands/orchestrate';
import { registerPipelineCommand } from './commands/pipeline';
import { registerRunCommand } from './commands/run';
import { registerGeneratePrdCommand, registerGenerateContextCommand } from './commands/generate';
import { registerMonitorCommand } from './commands/monitor';
import { registerInstallSkillsCommand, registerUpdateCommand } from './commands/utils';

let outputChannel: vscode.OutputChannel | undefined;
let statusBar: WispStatusBar | undefined;
let activeCli: WispCli | null = null;

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
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  activeCli = null;
}
