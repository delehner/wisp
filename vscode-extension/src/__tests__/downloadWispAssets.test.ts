import {
  findZipRootFromEntryNames,
  relativePathIfWispAsset,
  buildGitignoreAppend,
  WISP_ASSET_GITIGNORE_LINES,
} from '../commands/downloadWispAssets';

describe('downloadWispAssets helpers', () => {
  describe('findZipRootFromEntryNames', () => {
    it('uses .devcontainer path to infer root', () => {
      const root = findZipRootFromEntryNames([
        'wisp-main/',
        'wisp-main/.devcontainer/devcontainer.json',
        'wisp-main/src/main.rs',
      ]);
      expect(root).toBe('wisp-main/');
    });

    it('falls back to first file entry prefix', () => {
      const root = findZipRootFromEntryNames(['wisp-main/README.md']);
      expect(root).toBe('wisp-main/');
    });

    it('throws on empty zip', () => {
      expect(() => findZipRootFromEntryNames([])).toThrow('empty');
    });

    it('throws when there is no top-level folder', () => {
      expect(() => findZipRootFromEntryNames(['readme.txt'])).toThrow('top-level folder');
    });
  });

  describe('relativePathIfWispAsset', () => {
    const z = 'wisp-main/';

    it('keeps .devcontainer files', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/Dockerfile')).toBe(
        '.devcontainer/Dockerfile',
      );
    });

    it('keeps templates and agents', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/templates/foo.md')).toBe('templates/foo.md');
      expect(relativePathIfWispAsset(z, 'wisp-main/agents/dev/prompt.md')).toBe(
        'agents/dev/prompt.md',
      );
    });

    it('ignores other top-level folders', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/src/lib.rs')).toBeUndefined();
    });

    it('handles directory entries', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/agents/')).toBe('agents/');
    });
  });

  describe('buildGitignoreAppend', () => {
    it('returns null when all lines exist', () => {
      const existing = `.devcontainer/\ntemplates/\nagents/\n`;
      expect(buildGitignoreAppend(existing, WISP_ASSET_GITIGNORE_LINES)).toBeNull();
    });

    it('appends missing lines and header', () => {
      const append = buildGitignoreAppend('foo\n', ['.devcontainer/', 'agents/']);
      expect(append).toContain('.devcontainer/');
      expect(append).toContain('agents/');
      expect(append).not.toContain('templates/');
      expect(append).toMatch(/Wisp AI/);
    });

    it('no leading newline when file is empty', () => {
      const append = buildGitignoreAppend('', ['.devcontainer/']);
      expect(append).not.toMatch(/^\n\n# Wisp/);
      expect(append).toContain('# Wisp AI');
    });
  });
});
