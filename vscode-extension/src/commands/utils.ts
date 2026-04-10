import * as vscode from 'vscode';
import { WispCli } from '../wispCli';
import { WispStatusBar } from '../statusBar';

export const KNOWN_AGENTS = [
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

export async function pickManifestFile(cwd: string): Promise<string | undefined> {
  const uris = await vscode.workspace.findFiles('**/.devenv/manifests/*.json');
  if (uris.length > 0) {
    const items = uris.map((u) => u.fsPath);
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a manifest file',
      ignoreFocusOut: true,
    });
    return picked;
  }
  return vscode.window.showInputBox({
    prompt: 'No manifest files found. Enter path to manifest JSON',
    placeHolder: `${cwd}/.devenv/manifests/my-manifest.json`,
    ignoreFocusOut: true,
  });
}

export async function pickPrdFile(cwd: string): Promise<string | undefined> {
  const uris = await vscode.workspace.findFiles('**/.devenv/prds/**/*.md');
  if (uris.length > 0) {
    const items = uris.map((u) => u.fsPath);
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a PRD file',
      ignoreFocusOut: true,
    });
    return picked;
  }
  return vscode.window.showInputBox({
    prompt: 'No PRD files found. Enter path to PRD markdown file',
    placeHolder: `${cwd}/.devenv/prds/my-feature/prd.md`,
    ignoreFocusOut: true,
  });
}

export function stripAnsi(line: string): string {
  return line.replace(/\x1B\[[0-9;]*m/g, '');
}

export function normalizeLogLine(line: string): string {
  // Keep original content but remove terminal color/control escapes.
  return stripAnsi(line);
}

export function classifyLine(line: string): 'error' | 'warn' | 'info' | 'debug' {
  const s = normalizeLogLine(line);
  if (/ ERROR |error:/i.test(s)) return 'error';
  if (/ WARN |warning:/i.test(s)) return 'warn';
  if (/ DEBUG | TRACE /i.test(s)) return 'debug';
  return 'info';
}

function formatLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function runWithOutput(
  cli: WispCli,
  args: string[],
  cwd: string,
  outputChannel: vscode.LogOutputChannel,
  statusBar: WispStatusBar,
  onActivate?: (cli: WispCli) => void,
  onDone?: () => void,
): Promise<number> {
  if (cli.isRunning) {
    vscode.window.showWarningMessage('A Wisp AI pipeline is already running.');
    return 1;
  }

  outputChannel.show(true);
  statusBar.setRunning();
  onActivate?.(cli);

  const hr = '─'.repeat(48);
  const startMs = Date.now();
  outputChannel.appendLine(hr);
  outputChannel.appendLine(`▶ wisp ${args.join(' ')}`);
  outputChannel.appendLine(`  Started: ${formatLocalTime(new Date())}`);
  outputChannel.appendLine(hr);

  let exitCode = 0;
  let spawnError: Error | undefined;
  try {
    exitCode = await cli.run(
      args,
      cwd,
      (line) => {
        const formatted = normalizeLogLine(line);
        outputChannel[classifyLine(formatted)](formatted);
      },
      (line) => {
        const formatted = normalizeLogLine(line);
        outputChannel[classifyLine(formatted)](formatted);
      },
    );
    return exitCode;
  } catch (err) {
    spawnError = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const elapsed = Date.now() - startMs;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    const elapsedStr = `${mins}m ${secs}s`;

    outputChannel.appendLine(hr);
    if (spawnError) {
      outputChannel.error(`✘ Error: ${spawnError.message}  (elapsed: ${elapsedStr})`);
    } else if (exitCode === 0) {
      outputChannel.info(`✔ Finished  exit code 0  (elapsed: ${elapsedStr})`);
    } else {
      outputChannel.error(`✘ Failed  exit code ${exitCode}  (elapsed: ${elapsedStr})`);
    }
    outputChannel.appendLine(hr);

    statusBar.setIdle();
    onDone?.();
  }
}

export function registerInstallSkillsCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.LogOutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.installSkills', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage('Wisp AI: No workspace folder open.');
      return;
    }
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    const code = await runWithOutput(
      cli,
      ['install', 'skills'],
      cwd,
      outputChannel,
      statusBar,
      onActivate,
      onDone,
    );
    if (code === 0) {
      vscode.window.showInformationMessage('Wisp AI: Skills installed successfully.');
    } else {
      vscode.window.showErrorMessage(`Wisp AI: Install skills failed (exit code ${code}).`);
    }
  });
  context.subscriptions.push(cmd);
}

export function registerUpdateCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.LogOutputChannel,
  statusBar: WispStatusBar,
  onActivate: (cli: WispCli) => void,
  onDone: () => void,
): void {
  const cmd = vscode.commands.registerCommand('wisp.update', async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const cli = await WispCli.resolve();
    if (!cli) {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Wisp AI: Updating…', cancellable: false },
      async () => {
        const code = await runWithOutput(
          cli,
          ['update'],
          cwd,
          outputChannel,
          statusBar,
          onActivate,
          onDone,
        );
        if (code === 0) {
          vscode.window.showInformationMessage('Wisp AI: Updated successfully.');
        } else {
          vscode.window.showErrorMessage(`Wisp AI: Update failed (exit code ${code}).`);
        }
      },
    );
  });
  context.subscriptions.push(cmd);
}
