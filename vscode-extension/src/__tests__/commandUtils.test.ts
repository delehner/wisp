import * as vscode from 'vscode';
import { KNOWN_AGENTS, pickManifestFile, pickPrdFile } from '../commands/utils';

describe('KNOWN_AGENTS', () => {
  it('contains all 14 agents', () => {
    expect(KNOWN_AGENTS).toHaveLength(14);
    expect(KNOWN_AGENTS).toContain('architect');
    expect(KNOWN_AGENTS).toContain('developer');
    expect(KNOWN_AGENTS).toContain('tester');
    expect(KNOWN_AGENTS).toContain('reviewer');
    expect(KNOWN_AGENTS).toContain('designer');
    expect(KNOWN_AGENTS).toContain('migration');
    expect(KNOWN_AGENTS).toContain('accessibility');
    expect(KNOWN_AGENTS).toContain('performance');
    expect(KNOWN_AGENTS).toContain('secops');
    expect(KNOWN_AGENTS).toContain('dependency');
    expect(KNOWN_AGENTS).toContain('infrastructure');
    expect(KNOWN_AGENTS).toContain('devops');
    expect(KNOWN_AGENTS).toContain('rollback');
    expect(KNOWN_AGENTS).toContain('documentation');
  });
});

describe('pickManifestFile()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows QuickPick when workspace files are found', async () => {
    const fakeUri = { fsPath: '/workspace/manifests/test.json' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([fakeUri]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/manifests/test.json');

    const result = await pickManifestFile('/workspace');

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/manifests/*.json');
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      ['/workspace/manifests/test.json'],
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
    expect(result).toBe('/workspace/manifests/test.json');
  });

  it('falls back to showInputBox when no files found', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('/manually/typed/path.json');

    const result = await pickManifestFile('/workspace');

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBe('/manually/typed/path.json');
  });
});

describe('pickPrdFile()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows QuickPick when workspace PRD files are found', async () => {
    const fakeUri = { fsPath: '/workspace/prds/my-feature/prd.md' };
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([fakeUri]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('/workspace/prds/my-feature/prd.md');

    const result = await pickPrdFile('/workspace');

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/prds/**/*.md');
    expect(result).toBe('/workspace/prds/my-feature/prd.md');
  });

  it('falls back to showInputBox when no PRD files found', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);

    const result = await pickPrdFile('/workspace');

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
