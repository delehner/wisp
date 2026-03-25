import * as vscode from 'vscode';

const BREW_INSTALL = 'brew tap delehner/tap && brew install wisp';
const BREW_UPGRADE = 'brew upgrade wisp';

function isHomebrewPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux';
}

async function installCliViaHomebrew(): Promise<void> {
  if (!isHomebrewPlatform()) {
    vscode.window.showWarningMessage(
      'Wisp AI: Homebrew install is for macOS or Linux. On Windows, use the install script in the wisp README.',
    );
    return;
  }
  const terminal = vscode.window.createTerminal({ name: 'Wisp AI: Install CLI' });
  terminal.show();
  terminal.sendText(BREW_INSTALL, true);
  vscode.window.showInformationMessage(
    'Wisp AI: Ran `brew tap delehner/tap && brew install wisp` in a new terminal.',
  );
}

async function updateCliViaHomebrew(): Promise<void> {
  if (!isHomebrewPlatform()) {
    vscode.window.showWarningMessage(
      'Wisp AI: Homebrew upgrade is for macOS or Linux. For other installs, use “Wisp AI: Update” (wisp update) or reinstall from the README.',
    );
    return;
  }
  const terminal = vscode.window.createTerminal({ name: 'Wisp AI: Upgrade wisp (brew)' });
  terminal.show();
  terminal.sendText(BREW_UPGRADE, true);
  vscode.window.showInformationMessage('Wisp AI: Ran `brew upgrade wisp` in a new terminal.');
}

export function registerHomebrewCliCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('wisp.installCli', installCliViaHomebrew),
    vscode.commands.registerCommand('wisp.explorer.installCli', installCliViaHomebrew),
    vscode.commands.registerCommand('wisp.updateHomebrew', updateCliViaHomebrew),
    vscode.commands.registerCommand('wisp.explorer.updateHomebrew', updateCliViaHomebrew),
  );
}
