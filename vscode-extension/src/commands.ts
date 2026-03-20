import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveEnv } from './config';
import { ChatPanel } from './panels/chatPanel';
import type { AgentMeta } from './types/messages';
import { WispCli } from './wispCli';

const DEFAULT_AGENTS = [
  'architect',
  'designer',
  'migration',
  'developer',
  'accessibility',
  'tester',
  'performance',
  'secops',
  'dependency',
  'infrastructure',
  'devops',
  'rollback',
  'documentation',
  'reviewer',
];

const NON_BLOCKING_AGENTS = new Set([
  'designer',
  'migration',
  'accessibility',
  'performance',
  'dependency',
  'rollback',
  'documentation',
]);

export class CommandHandlers {
  private root: string | undefined;

  constructor(
    private readonly cliFactory: () => Promise<WispCli | null>,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly extensionUri?: vscode.Uri,
  ) {}

  updateRoot(root: string | undefined): void {
    this.root = root;
  }

  async showVersion(): Promise<void> {
    const cli = await this.resolveCli();
    if (!cli) return;
    const env = await this.buildEnv();
    const result = await cli.runCapture(['--version'], process.cwd(), { env });
    const version = result.stdout.trim() || result.stderr.trim();
    vscode.window.showInformationMessage(`Wisp version: ${version}`);
  }

  async orchestrate(manifestUri?: vscode.Uri): Promise<void> {
    let resolvedUri = manifestUri;
    if (!resolvedUri) {
      resolvedUri = await this.pickManifest();
      if (!resolvedUri) return;
    }

    const manifestPath = resolvedUri.fsPath;
    const cwd = this.workspaceRoot() ?? path.dirname(manifestPath);
    const panel = this.openChatPanel();
    panel?.notifyPipelineStart(path.basename(manifestPath), this.allAgentMeta());

    await this.withProgress('Wisp: Orchestrating...', async (token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      this.outputChannel.show();

      const actionSub = panel?.onUserAction((msg) => {
        if (msg.type === 'skipAgent') cli.write('s\n');
        else if (msg.type === 'continueAgent') cli.write('c\n');
        else if (msg.type === 'abortPipeline') cli.write('q\n');
      });

      const env = await this.buildEnv();
      let currentAgent = 'orchestrate';
      await cli.run(
        ['orchestrate', '--manifest', manifestPath],
        cwd,
        (line) => {
          this.outputChannel.appendLine(line);
          currentAgent = this.detectAgentChange(line, currentAgent, panel);
          panel?.handleStdout(currentAgent, line);
        },
        (line) => {
          this.outputChannel.appendLine(line);
          panel?.handleStderr(currentAgent, line);
        },
        { cancellationToken: token, env },
      );

      actionSub?.dispose();
    });
  }

  async pipeline(prdUri?: vscode.Uri): Promise<void> {
    let prdPath: string | undefined;
    if (prdUri) {
      prdPath = prdUri.fsPath;
    } else {
      prdPath = await vscode.window.showInputBox({
        prompt: 'Path to PRD file',
        placeHolder: 'prds/my-feature.md',
      });
      if (!prdPath) return;
    }

    const repoUrl = await vscode.window.showInputBox({
      prompt: 'Target repository URL',
      placeHolder: 'https://github.com/org/repo',
    });
    if (!repoUrl) return;

    const cwd = this.workspaceRoot() ?? process.cwd();
    const panel = this.openChatPanel();
    panel?.notifyPipelineStart(path.basename(prdPath), this.allAgentMeta());

    await this.withProgress('Wisp: Running Pipeline...', async (token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      this.outputChannel.show();

      const actionSub = panel?.onUserAction((msg) => {
        if (msg.type === 'skipAgent') cli.write('s\n');
        else if (msg.type === 'continueAgent') cli.write('c\n');
        else if (msg.type === 'abortPipeline') cli.write('q\n');
      });

      const env = await this.buildEnv();
      let currentAgent = 'pipeline';
      await cli.run(
        ['pipeline', '--prd', prdPath, '--repo', repoUrl],
        cwd,
        (line) => {
          this.outputChannel.appendLine(line);
          currentAgent = this.detectAgentChange(line, currentAgent, panel);
          panel?.handleStdout(currentAgent, line);
        },
        (line) => {
          this.outputChannel.appendLine(line);
          panel?.handleStderr(currentAgent, line);
        },
        { cancellationToken: token, env },
      );

      actionSub?.dispose();
    });
  }

  async run(): Promise<void> {
    const agentItems = DEFAULT_AGENTS.map((a) => ({ label: a }));
    const picked = await vscode.window.showQuickPick(agentItems, { placeHolder: 'Select agent' });
    if (!picked) return;

    const workdir = await vscode.window.showInputBox({
      prompt: 'Working directory',
      value: this.workspaceRoot() ?? process.cwd(),
    });
    if (!workdir) return;

    const prdPath = await vscode.window.showInputBox({
      prompt: 'Path to PRD file',
      placeHolder: 'prds/my-feature.md',
    });
    if (!prdPath) return;

    const agentName = picked.label;
    const panel = this.openChatPanel();
    panel?.notifyPipelineStart(agentName, [
      { name: agentName, isBlocking: !NON_BLOCKING_AGENTS.has(agentName) },
    ]);
    panel?.notifyAgentStart(agentName);

    await this.withProgress(`Wisp: Running ${agentName}...`, async (token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      this.outputChannel.show();

      const actionSub = panel?.onUserAction((msg) => {
        if (msg.type === 'skipAgent') cli.write('s\n');
        else if (msg.type === 'continueAgent') cli.write('c\n');
        else if (msg.type === 'abortPipeline') cli.write('q\n');
      });

      const env = await this.buildEnv();
      await cli.run(
        ['run', '--agent', agentName, '--workdir', workdir, '--prd', prdPath],
        workdir,
        (line) => {
          this.outputChannel.appendLine(line);
          panel?.handleStdout(agentName, line);
        },
        (line) => {
          this.outputChannel.appendLine(line);
          panel?.handleStderr(agentName, line);
        },
        { cancellationToken: token, env },
      );

      actionSub?.dispose();
    });
  }

  async generatePrd(): Promise<void> {
    const description = await vscode.window.showInputBox({
      prompt: 'Describe the feature for the PRD',
      placeHolder: 'A feature that does X, Y, and Z',
    });
    if (!description) return;

    const cwd = this.workspaceRoot() ?? process.cwd();
    await this.withProgress('Wisp: Generating PRD...', async (_token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      const env = await this.buildEnv();
      const result = await cli.runCapture(
        ['generate', 'prd', '--description', description],
        cwd,
        { env },
      );
      if (result.code !== 0) {
        vscode.window.showErrorMessage(`Failed to generate PRD: ${result.stderr}`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: result.stdout,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc);
    });
  }

  async generateContext(): Promise<void> {
    const repoUrl = await vscode.window.showInputBox({
      prompt: 'Repository URL to generate context for',
      placeHolder: 'https://github.com/org/repo',
    });
    if (!repoUrl) return;

    const cwd = this.workspaceRoot() ?? process.cwd();
    const ok = await this.withProgress('Wisp: Generating Context...', async (token) => {
      const cli = await this.resolveCli();
      if (!cli) return false;
      this.outputChannel.show();
      const env = await this.buildEnv();
      const code = await cli.run(
        ['generate', 'context', '--repo', repoUrl],
        cwd,
        (line) => this.outputChannel.appendLine(line),
        (line) => this.outputChannel.appendLine(line),
        { cancellationToken: token, env },
      );
      return code === 0;
    });
    if (ok) {
      vscode.window.showInformationMessage('Context generated in contexts/');
    }
  }

  async monitor(): Promise<void> {
    const defaultWorkdir = this.workspaceRoot() ?? process.cwd();
    const workdir = await vscode.window.showInputBox({
      prompt: 'Working directory to monitor',
      value: defaultWorkdir,
    });
    if (!workdir) return;

    await this.withProgress('Wisp: Monitoring...', async (token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      this.outputChannel.show();
      const env = await this.buildEnv();
      await cli.run(
        ['monitor', '--workdir', workdir],
        workdir,
        (line) => this.outputChannel.appendLine(line),
        (line) => this.outputChannel.appendLine(line),
        { cancellationToken: token, env },
      );
    });
  }

  async installSkills(): Promise<void> {
    const cwd = this.workspaceRoot() ?? process.cwd();
    await this.withProgress('Wisp: Installing Skills...', async (_token) => {
      const cli = await this.resolveCli();
      if (!cli) return;
      const env = await this.buildEnv();
      const result = await cli.runCapture(['install', 'skills'], cwd, { env });
      if (result.code !== 0) {
        vscode.window.showErrorMessage(`Failed to install skills: ${result.stderr}`);
      } else {
        vscode.window.showInformationMessage('Wisp skills installed successfully');
      }
    });
  }

  openChatPanel(): ChatPanel | undefined {
    if (!this.extensionUri) return undefined;
    return ChatPanel.createOrShow(this.extensionUri);
  }

  private async buildEnv(): Promise<Record<string, string>> {
    const root = this.workspaceRoot() ?? process.cwd();
    return resolveEnv(root);
  }

  private detectAgentChange(
    line: string,
    current: string,
    panel: ChatPanel | undefined,
  ): string {
    // Detect wisp log lines like: "starting agent architect, iteration 1"
    const match = /starting agent[:\s]+([a-z_]+)/i.exec(line);
    if (match && match[1] !== current) {
      const agent = match[1];
      panel?.notifyAgentStart(agent);
      return agent;
    }
    return current;
  }

  private async resolveCli(): Promise<WispCli | null> {
    const cli = await this.cliFactory();
    if (!cli) {
      vscode.window.showErrorMessage(
        'Wisp binary not found. Check the wisp.binaryPath setting or install wisp.',
      );
    }
    return cli;
  }

  private async pickManifest(): Promise<vscode.Uri | undefined> {
    const uris = await vscode.workspace.findFiles('**/manifests/**/*.json');
    if (uris.length === 0) {
      vscode.window.showErrorMessage('No manifest files found in workspace');
      return undefined;
    }

    const items = uris
      .map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select manifest file' });
    return picked?.uri;
  }

  private workspaceRoot(): string | undefined {
    if (this.root) return this.root;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async withProgress<T>(
    title: string,
    task: (token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T | undefined> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      (_progress, token) => task(token),
    );
  }

  private allAgentMeta(): AgentMeta[] {
    return DEFAULT_AGENTS.map((name) => ({
      name,
      isBlocking: !NON_BLOCKING_AGENTS.has(name),
    }));
  }
}
