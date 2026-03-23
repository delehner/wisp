import * as vscode from 'vscode';

const DEBOUNCE_MS = 500;

export class WispFileWatcher implements vscode.Disposable {
  private readonly _watchers: vscode.FileSystemWatcher[];
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onRefresh: () => void) {
    this._watchers = [
      vscode.workspace.createFileSystemWatcher('**/manifests/*.json'),
      vscode.workspace.createFileSystemWatcher('**/prds/**/*.md'),
    ];

    for (const watcher of this._watchers) {
      watcher.onDidCreate(() => this._scheduleRefresh());
      watcher.onDidChange(() => this._scheduleRefresh());
      watcher.onDidDelete(() => this._scheduleRefresh());
    }
  }

  private _scheduleRefresh(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      this.onRefresh();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    for (const watcher of this._watchers) {
      watcher.dispose();
    }
  }
}
