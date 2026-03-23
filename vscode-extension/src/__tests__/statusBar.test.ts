import * as vscode from 'vscode';
import { WispStatusBar } from '../statusBar';

describe('WispStatusBar', () => {
  let mockItem: { text: string; command: string; show: jest.Mock; dispose: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockItem = { text: '', command: '', show: jest.fn(), dispose: jest.fn() };
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockItem);
  });

  it('initializes with idle text and shows the item', () => {
    new WispStatusBar();
    expect(mockItem.text).toBe('$(check) Wisp: Idle');
    expect(mockItem.show).toHaveBeenCalled();
  });

  it('sets command to wisp.showOutput on construction', () => {
    new WispStatusBar();
    expect(mockItem.command).toBe('wisp.showOutput');
  });

  it('setRunning() sets spinning indicator text', () => {
    const bar = new WispStatusBar();
    bar.setRunning();
    expect(mockItem.text).toBe('$(sync~spin) Wisp: Running');
  });

  it('setIdle() restores idle indicator text', () => {
    const bar = new WispStatusBar();
    bar.setRunning();
    bar.setIdle();
    expect(mockItem.text).toBe('$(check) Wisp: Idle');
  });

  it('dispose() delegates to the underlying status bar item', () => {
    const bar = new WispStatusBar();
    bar.dispose();
    expect(mockItem.dispose).toHaveBeenCalled();
  });
});
