import * as vscode from 'vscode';
import { WispFileWatcher } from '../treeView/watcher';

describe('WispFileWatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates two file system watchers with correct globs', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/manifests/*.json');
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/prds/**/*.md');

    watcher.dispose();
  });

  it('registers onDidCreate, onDidChange, and onDidDelete on each watcher', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const results = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
    expect(results).toHaveLength(2);
    for (const result of results) {
      const fsw = result.value;
      expect(fsw.onDidCreate).toHaveBeenCalledTimes(1);
      expect(fsw.onDidChange).toHaveBeenCalledTimes(1);
      expect(fsw.onDidDelete).toHaveBeenCalledTimes(1);
    }

    watcher.dispose();
  });

  it('calls onRefresh after 500 ms debounce on file create', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const fsw = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[0].value;
    const onCreate = (fsw.onDidCreate as jest.Mock).mock.calls[0][0] as () => void;

    onCreate();
    expect(onRefresh).not.toHaveBeenCalled();

    jest.advanceTimersByTime(499);
    expect(onRefresh).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('debounces multiple rapid events into a single onRefresh call', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const fsw = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[0].value;
    const onCreate = (fsw.onDidCreate as jest.Mock).mock.calls[0][0] as () => void;
    const onChange = (fsw.onDidChange as jest.Mock).mock.calls[0][0] as () => void;
    const onDelete = (fsw.onDidDelete as jest.Mock).mock.calls[0][0] as () => void;

    onCreate();
    jest.advanceTimersByTime(100);
    onChange();
    jest.advanceTimersByTime(100);
    onDelete();
    jest.advanceTimersByTime(100);
    onCreate();

    // Still inside debounce window
    expect(onRefresh).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('fires onRefresh for events on the second (PRDs) watcher too', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const fsw = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[1].value;
    const onCreate = (fsw.onDidCreate as jest.Mock).mock.calls[0][0] as () => void;

    onCreate();
    jest.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('dispose() prevents pending debounce from firing onRefresh', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const fsw = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[0].value;
    const onCreate = (fsw.onDidCreate as jest.Mock).mock.calls[0][0] as () => void;

    onCreate();
    watcher.dispose();

    jest.advanceTimersByTime(500);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('dispose() calls dispose() on each underlying file system watcher', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    watcher.dispose();

    const results = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
    for (const result of results) {
      expect(result.value.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('allows multiple independent refresh cycles after debounce settles', () => {
    const onRefresh = jest.fn();
    const watcher = new WispFileWatcher(onRefresh);

    const fsw = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[0].value;
    const onCreate = (fsw.onDidCreate as jest.Mock).mock.calls[0][0] as () => void;

    onCreate();
    jest.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    onCreate();
    jest.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    watcher.dispose();
  });
});
