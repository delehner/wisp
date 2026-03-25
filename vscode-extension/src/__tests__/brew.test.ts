import * as vscode from 'vscode';
import { registerHomebrewCliCommands } from '../commands/brew';

describe('registerHomebrewCliCommands', () => {
  const originalPlatform = process.platform;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: { push: jest.fn() } } as unknown as vscode.ExtensionContext;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('registers palette and explorer command ids for Homebrew install/update', () => {
    registerHomebrewCliCommands(context);
    const ids = (vscode.commands.registerCommand as jest.Mock).mock.calls.map((c) => c[0]);
    expect(ids).toContain('wisp.installCli');
    expect(ids).toContain('wisp.explorer.installCli');
    expect(ids).toContain('wisp.updateHomebrew');
    expect(ids).toContain('wisp.explorer.updateHomebrew');
    expect(context.subscriptions.push).toHaveBeenCalledTimes(1);
  });

  it('installCli runs brew tap and install in a terminal on darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const sendText = jest.fn();
    const show = jest.fn();
    (vscode.window.createTerminal as jest.Mock).mockReturnValue({ sendText, show });

    registerHomebrewCliCommands(context);
    const [, handler] = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'wisp.installCli',
    )!;
    await handler();

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wisp AI: Install CLI' }),
    );
    expect(show).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('brew tap delehner/tap && brew install wisp', true);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('updateHomebrew runs brew upgrade wisp on linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sendText = jest.fn();
    const show = jest.fn();
    (vscode.window.createTerminal as jest.Mock).mockReturnValue({ sendText, show });

    registerHomebrewCliCommands(context);
    const [, handler] = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'wisp.explorer.updateHomebrew',
    )!;
    await handler();

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wisp AI: Upgrade wisp (brew)' }),
    );
    expect(sendText).toHaveBeenCalledWith('brew upgrade wisp', true);
  });

  it('installCli warns and skips terminal on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    registerHomebrewCliCommands(context);
    const [, handler] = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'wisp.explorer.installCli',
    )!;
    await handler();

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });
});
