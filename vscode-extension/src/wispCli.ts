import * as cp from 'node:child_process';
import * as readline from 'node:readline';
import * as vscode from 'vscode';

const INSTALL_URL = 'https://github.com/delehner/wisp#installation';

export interface RunOptions {
  outputChannel?: vscode.OutputChannel;
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class WispCli {
  private _proc: cp.ChildProcess | null = null;

  private constructor(private readonly binaryPath: string) {}

  cancel(): void {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
  }

  get isRunning(): boolean {
    return this._proc !== null;
  }

  static async resolve(): Promise<WispCli | null> {
    const config = vscode.workspace.getConfiguration('wisp');
    const override = config.get<string>('binaryPath');
    if (override && override.trim()) {
      return new WispCli(override.trim());
    }

    const found = await WispCli.findOnPath();
    if (found) {
      return new WispCli(found);
    }

    const action = await vscode.window.showInformationMessage(
      'Wisp binary not found. Install it?',
      'Install',
    );
    if (action === 'Install') {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
    }
    return null;
  }

  private static findOnPath(): Promise<string | null> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      cp.exec(`${cmd} wisp`, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
        } else {
          resolve(stdout.trim().split('\n')[0].trim());
        }
      });
    });
  }

  async run(
    args: string[],
    cwd: string,
    onStdout: (line: string) => void,
    onStderr: (line: string) => void,
    opts?: RunOptions,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = cp.spawn(this.binaryPath, args, { cwd });
      this._proc = proc;

      const rlOut = readline.createInterface({ input: proc.stdout });
      rlOut.on('line', (line) => {
        onStdout(line);
        opts?.outputChannel?.appendLine(`[stdout] ${line}`);
      });

      const rlErr = readline.createInterface({ input: proc.stderr });
      rlErr.on('line', (line) => {
        onStderr(line);
        opts?.outputChannel?.appendLine(`[stderr] ${line}`);
      });

      proc.on('error', (err) => {
        this._proc = null;
        reject(err);
      });
      proc.on('close', (code) => {
        this._proc = null;
        resolve(code ?? 1);
      });
    });
  }

  async runCapture(args: string[], cwd: string): Promise<CaptureResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const code = await this.run(
      args,
      cwd,
      (l) => stdoutLines.push(l),
      (l) => stderrLines.push(l),
    );

    return {
      stdout: stdoutLines.join('\n'),
      stderr: stderrLines.join('\n'),
      code,
    };
  }
}
