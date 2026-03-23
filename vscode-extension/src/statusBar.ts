import * as vscode from 'vscode';

export class WispStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'wisp.showOutput';
    this.setIdle();
    this.item.show();
  }

  setRunning(): void {
    this.item.text = '$(sync~spin) Wisp: Running';
  }

  setIdle(): void {
    this.item.text = '$(check) Wisp: Idle';
  }

  dispose(): void {
    this.item.dispose();
  }
}
