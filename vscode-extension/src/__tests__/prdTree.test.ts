import * as vscode from 'vscode';
import { WispTreeItem } from '../views/manifestTree';
import { PrdTreeDataProvider } from '../views/prdTree';

describe('PrdTreeDataProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      onDidChange: jest.fn(),
      dispose: jest.fn(),
    });
  });

  it('returns empty-state item when no PRDs found', async () => {
    const provider = new PrdTreeDataProvider();

    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect(children[0].label).toBe('No PRDs found in workspace');
  });

  it('returns PRD items when files are found', async () => {
    const uri1 = { fsPath: '/workspace/prds/a.md', toString: () => '/workspace/prds/a.md' };
    const uri2 = { fsPath: '/workspace/prds/b.md', toString: () => '/workspace/prds/b.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri2, uri1]);
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation(
      (u: { fsPath: string }) => u.fsPath.replace('/workspace/', ''),
    );

    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children).toHaveLength(2);
    // Should be sorted alphabetically
    expect(children[0].label).toBe('prds/a.md');
    expect(children[1].label).toBe('prds/b.md');
  });

  it('sets contextValue to prdFile on file items', async () => {
    const uri = { fsPath: '/workspace/prds/my.md', toString: () => '/workspace/prds/my.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('prds/my.md');

    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children[0].contextValue).toBe('prdFile');
  });

  it('wires vscode.open command on file items', async () => {
    const uri = { fsPath: '/workspace/prds/my.md', toString: () => '/workspace/prds/my.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('prds/my.md');

    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children[0].command?.command).toBe('vscode.open');
    expect(children[0].command?.arguments).toEqual([uri]);
  });

  it('returns empty array for non-root element', async () => {
    const provider = new PrdTreeDataProvider();
    const parent = new WispTreeItem('parent', vscode.TreeItemCollapsibleState.None);

    const children = await provider.getChildren(parent);

    expect(children).toEqual([]);
  });

  it('fires onDidChangeTreeData when refresh() is called', () => {
    const provider = new PrdTreeDataProvider();
    const fireMethod = (provider as unknown as { _onDidChangeTreeData: { fire: jest.Mock } })
      ._onDidChangeTreeData.fire;

    provider.refresh();

    expect(fireMethod).toHaveBeenCalled();
  });

  it('disposes watcher on dispose()', () => {
    const mockDispose = jest.fn();
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      onDidChange: jest.fn(),
      dispose: mockDispose,
    });

    const provider = new PrdTreeDataProvider();
    provider.dispose();

    expect(mockDispose).toHaveBeenCalled();
  });

  it('calls refresh() when FileSystemWatcher fires onDidCreate', () => {
    let createCallback: (() => void) | undefined;
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn((cb: () => void) => { createCallback = cb; }),
      onDidDelete: jest.fn(),
      onDidChange: jest.fn(),
      dispose: jest.fn(),
    });

    const provider = new PrdTreeDataProvider();
    const fireMethod = (provider as unknown as { _onDidChangeTreeData: { fire: jest.Mock } })
      ._onDidChangeTreeData.fire;

    createCallback?.();

    expect(fireMethod).toHaveBeenCalled();
  });

  it('calls refresh() when FileSystemWatcher fires onDidDelete', () => {
    let deleteCallback: (() => void) | undefined;
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn((cb: () => void) => { deleteCallback = cb; }),
      onDidChange: jest.fn(),
      dispose: jest.fn(),
    });

    const provider = new PrdTreeDataProvider();
    const fireMethod = (provider as unknown as { _onDidChangeTreeData: { fire: jest.Mock } })
      ._onDidChangeTreeData.fire;

    deleteCallback?.();

    expect(fireMethod).toHaveBeenCalled();
  });

  it('calls refresh() when FileSystemWatcher fires onDidChange', () => {
    let changeCallback: (() => void) | undefined;
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      onDidChange: jest.fn((cb: () => void) => { changeCallback = cb; }),
      dispose: jest.fn(),
    });

    const provider = new PrdTreeDataProvider();
    const fireMethod = (provider as unknown as { _onDidChangeTreeData: { fire: jest.Mock } })
      ._onDidChangeTreeData.fire;

    changeCallback?.();

    expect(fireMethod).toHaveBeenCalled();
  });

  it('uses $(book) ThemeIcon for PRD file items', async () => {
    const uri = { fsPath: '/workspace/prds/my.md', toString: () => '/workspace/prds/my.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('prds/my.md');

    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children[0].iconPath).toEqual(expect.objectContaining({ id: 'book' }));
  });

  it('sets tooltip to file path on PRD items', async () => {
    const uri = { fsPath: '/workspace/prds/my.md', toString: () => '/workspace/prds/my.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('prds/my.md');

    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children[0].tooltip).toBe('/workspace/prds/my.md');
  });

  it('sets tooltip on empty-state item', async () => {
    const provider = new PrdTreeDataProvider();
    const children = await provider.getChildren();

    expect(children[0].tooltip).toBeTruthy();
  });

  it('watches the correct glob pattern', () => {
    new PrdTreeDataProvider();

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
      '**/prds/**/*.md',
    );
  });

  it('getTreeItem returns the element unchanged', () => {
    const provider = new PrdTreeDataProvider();
    const item = new WispTreeItem('test', vscode.TreeItemCollapsibleState.None);

    const result = provider.getTreeItem(item);

    expect(result).toBe(item);
  });
});
