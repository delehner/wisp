import * as vscode from 'vscode';
import { CommandHandlers } from './commands';
import { resolveWispRoot } from './config';
import { ChatPanel } from './panels/chatPanel';
import { WispStatusBar } from './statusBar';
import { ManifestTreeDataProvider } from './views/manifestTree';
import { PrdTreeDataProvider } from './views/prdTree';
import { WispCli } from './wispCli';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Wisp');
  context.subscriptions.push(outputChannel);

  const cliFactory = () => WispCli.resolve();

  const statusBar = new WispStatusBar(cliFactory);
  context.subscriptions.push(statusBar);

  const manifestProvider = new ManifestTreeDataProvider();
  context.subscriptions.push(manifestProvider);

  const prdProvider = new PrdTreeDataProvider();
  context.subscriptions.push(prdProvider);

  const manifestTreeView = vscode.window.createTreeView('wispManifests', {
    treeDataProvider: manifestProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(manifestTreeView);

  const prdTreeView = vscode.window.createTreeView('wispPrds', {
    treeDataProvider: prdProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(prdTreeView);

  const handlers = new CommandHandlers(cliFactory, outputChannel, context.extensionUri);
  handlers.updateRoot(resolveWispRoot());

  // Update root when workspace folders change
  const folderChangeSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    handlers.updateRoot(resolveWispRoot());
    void statusBar.update(resolveWispRoot());
  });
  context.subscriptions.push(folderChangeSub);

  // Update status bar when binaryPath setting changes
  const configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('wisp.binaryPath')) {
      void statusBar.update(resolveWispRoot());
    }
  });
  context.subscriptions.push(configChangeSub);

  // Register all commands
  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.showVersion', () => handlers.showVersion()),
    vscode.commands.registerCommand('wisp.orchestrate', (uri?: vscode.Uri) =>
      handlers.orchestrate(uri),
    ),
    vscode.commands.registerCommand('wisp.pipeline', (uri?: vscode.Uri) =>
      handlers.pipeline(uri),
    ),
    vscode.commands.registerCommand('wisp.run', () => handlers.run()),
    vscode.commands.registerCommand('wisp.generatePrd', () => handlers.generatePrd()),
    vscode.commands.registerCommand('wisp.generateContext', () => handlers.generateContext()),
    vscode.commands.registerCommand('wisp.monitor', () => handlers.monitor()),
    vscode.commands.registerCommand('wisp.installSkills', () => handlers.installSkills()),
    vscode.commands.registerCommand('wisp.openChatPanel', () => handlers.openChatPanel()),
  );

  // Initial status bar update
  void statusBar.update(resolveWispRoot());
}

export function deactivate(): void {
  ChatPanel.currentPanel?.dispose();
}
