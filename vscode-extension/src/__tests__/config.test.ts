import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { parseEnvFile, resolveEnv, resolveWispRoot } from '../config';

describe('parseEnvFile()', () => {
  it('parses simple KEY=VALUE pairs', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('skips lines starting with #', () => {
    const result = parseEnvFile('# this is a comment\nFOO=bar');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('skips empty lines', () => {
    const result = parseEnvFile('\n\nFOO=bar\n\n');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('skips lines without =', () => {
    const result = parseEnvFile('INVALID_LINE\nFOO=bar');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('strips surrounding double quotes from value', () => {
    const result = parseEnvFile('FOO="hello world"');
    expect(result).toEqual({ FOO: 'hello world' });
  });

  it('strips surrounding single quotes from value', () => {
    const result = parseEnvFile("FOO='hello world'");
    expect(result).toEqual({ FOO: 'hello world' });
  });

  it('does not strip mismatched quotes', () => {
    const result = parseEnvFile('FOO="hello world\'');
    expect(result).toEqual({ FOO: '"hello world\'' });
  });

  it('handles value containing = sign', () => {
    const result = parseEnvFile('FOO=a=b=c');
    expect(result).toEqual({ FOO: 'a=b=c' });
  });

  it('handles empty value', () => {
    const result = parseEnvFile('FOO=');
    expect(result).toEqual({ FOO: '' });
  });

  it('trims whitespace from keys', () => {
    const result = parseEnvFile('  FOO  =bar');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('handles inline # that is not a comment', () => {
    const result = parseEnvFile('FOO=bar#notacomment');
    expect(result).toEqual({ FOO: 'bar#notacomment' });
  });

  it('returns empty object for empty content', () => {
    expect(parseEnvFile('')).toEqual({});
  });
});

describe('resolveEnv()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wisp-test-'));
    jest.clearAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      inspect: jest.fn().mockReturnValue(undefined),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when no .env or .wisp files exist', async () => {
    const result = await resolveEnv(tmpDir);
    expect(result).toEqual({});
  });

  it('reads and parses .env file', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'WISP_PROVIDER=gemini\nWISP_MAX_PARALLEL=5');

    const result = await resolveEnv(tmpDir);

    expect(result['WISP_PROVIDER']).toBe('gemini');
    expect(result['WISP_MAX_PARALLEL']).toBe('5');
  });

  it('reads and parses .wisp JSON file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.wisp'),
      JSON.stringify({ provider: 'gemini', maxParallel: 5 }),
    );

    const result = await resolveEnv(tmpDir);

    expect(result['WISP_PROVIDER']).toBe('gemini');
    expect(result['WISP_MAX_PARALLEL']).toBe('5');
  });

  it('.wisp values override .env values', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'WISP_PROVIDER=claude');
    fs.writeFileSync(path.join(tmpDir, '.wisp'), JSON.stringify({ provider: 'gemini' }));

    const result = await resolveEnv(tmpDir);

    expect(result['WISP_PROVIDER']).toBe('gemini');
  });

  it('VSCode settings override .wisp values', async () => {
    fs.writeFileSync(path.join(tmpDir, '.wisp'), JSON.stringify({ provider: 'claude' }));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'provider') return 'gemini';
        return undefined;
      }),
      // Simulate 'provider' explicitly set in workspace settings
      inspect: jest.fn().mockImplementation((key: string) =>
        key === 'provider' ? { workspaceValue: 'gemini' } : undefined,
      ),
    });

    const result = await resolveEnv(tmpDir);

    expect(result['WISP_PROVIDER']).toBe('gemini');
  });

  it('VSCode default values do not override .env or .wisp values', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'WISP_SKIP_PR=true\nWISP_MAX_PARALLEL=8');
    // Simulate VSCode returning its schema defaults (not user-configured)
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'skipPr') return false; // schema default
        if (key === 'maxParallel') return 3; // schema default
        return undefined;
      }),
      inspect: jest.fn().mockReturnValue(undefined), // no explicit user config
    });

    const result = await resolveEnv(tmpDir);

    // .env values should win since VSCode values are just defaults (not explicitly set)
    expect(result['WISP_SKIP_PR']).toBe('true');
    expect(result['WISP_MAX_PARALLEL']).toBe('8');
  });

  it('swallows malformed .wisp JSON gracefully', async () => {
    fs.writeFileSync(path.join(tmpDir, '.wisp'), '{ invalid json }');

    await expect(resolveEnv(tmpDir)).resolves.not.toThrow();
  });

  it('does not include auth tokens from VSCode settings', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('some-value'),
      inspect: jest.fn().mockReturnValue({ globalValue: 'some-value' }),
    });

    const result = await resolveEnv(tmpDir);

    expect(result['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(result['GITHUB_TOKEN']).toBeUndefined();
    expect(result['GEMINI_API_KEY']).toBeUndefined();
  });
});

describe('resolveWispRoot()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.workspaceFolders as unknown) = undefined;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(''),
      inspect: jest.fn().mockReturnValue(undefined),
    });
  });

  it('returns undefined when no workspace folders', () => {
    expect(resolveWispRoot()).toBeUndefined();
  });

  it('returns first folder when no manifests/ directory', () => {
    (vscode.workspace.workspaceFolders as unknown) = [
      { name: 'myapp', uri: { fsPath: '/workspace/myapp' } },
    ];

    const result = resolveWispRoot();

    expect(result).toBe('/workspace/myapp');
  });

  it('returns folder matching wisp.rootFolder setting', () => {
    (vscode.workspace.workspaceFolders as unknown) = [
      { name: 'frontend', uri: { fsPath: '/workspace/frontend' } },
      { name: 'backend', uri: { fsPath: '/workspace/backend' } },
    ];
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => (key === 'rootFolder' ? 'backend' : '')),
    });

    const result = resolveWispRoot();

    expect(result).toBe('/workspace/backend');
  });

  it('prefers folder containing manifests/ directory over first folder', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wisp-root1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wisp-root2-'));
    try {
      fs.mkdirSync(path.join(dir2, 'manifests'));
      (vscode.workspace.workspaceFolders as unknown) = [
        { name: 'root1', uri: { fsPath: dir1 } },
        { name: 'root2', uri: { fsPath: dir2 } },
      ];

      const result = resolveWispRoot();

      expect(result).toBe(dir2);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
