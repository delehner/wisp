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

    it('remaps .devcontainer/agent files to .devenv/.devcontainer/agent/', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/agent/devcontainer.json')).toBe(
        '.devenv/.devcontainer/agent/devcontainer.json',
      );
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/agent/Dockerfile')).toBe(
        '.devenv/.devcontainer/agent/Dockerfile',
      );
    });

    it('excludes main .devcontainer files (not under agent/)', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/Dockerfile')).toBeUndefined();
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/devcontainer.json')).toBeUndefined();
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/init-firewall.sh')).toBeUndefined();
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/post-start.sh')).toBeUndefined();
    });

    it('remaps templates to .devenv/templates/', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/templates/foo.md')).toBe('.devenv/templates/foo.md');
      expect(relativePathIfWispAsset(z, 'wisp-main/templates/manifest.json')).toBe(
        '.devenv/templates/manifest.json',
      );
    });

    it('remaps agents to .ai/agents/', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/agents/dev/prompt.md')).toBe(
        '.ai/agents/dev/prompt.md',
      );
      expect(relativePathIfWispAsset(z, 'wisp-main/agents/_base-system.md')).toBe(
        '.ai/agents/_base-system.md',
      );
    });

    it('remaps skills to .ai/skills/', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/skills/code-review/SKILL.md')).toBe(
        '.ai/skills/code-review/SKILL.md',
      );
      expect(relativePathIfWispAsset(z, 'wisp-main/skills/testing-strategy/SKILL.md')).toBe(
        '.ai/skills/testing-strategy/SKILL.md',
      );
    });

    it('ignores other top-level folders', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/src/lib.rs')).toBeUndefined();
    });

    it('handles directory entries', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/agents/')).toBe('.ai/agents/');
      expect(relativePathIfWispAsset(z, 'wisp-main/skills/')).toBe('.ai/skills/');
      expect(relativePathIfWispAsset(z, 'wisp-main/templates/')).toBe('.devenv/templates/');
    });

    it('handles .devcontainer/agent directory entry', () => {
      expect(relativePathIfWispAsset(z, 'wisp-main/.devcontainer/agent/')).toBe('.devenv/.devcontainer/agent/');
    });
  });

  describe('buildGitignoreAppend', () => {
    it('returns null when all lines exist', () => {
      const existing = `.ai/agents/\n.ai/skills/\n.devenv/.devcontainer/\n.devenv/templates/\n`;
      expect(buildGitignoreAppend(existing, WISP_ASSET_GITIGNORE_LINES)).toBeNull();
    });

    it('appends missing lines and header', () => {
      const append = buildGitignoreAppend('foo\n', WISP_ASSET_GITIGNORE_LINES);
      expect(append).toContain('.ai/agents/');
      expect(append).toContain('.ai/skills/');
      expect(append).toContain('.devenv/.devcontainer/');
      expect(append).toContain('.devenv/templates/');
      expect(append).toMatch(/Wisp AI/);
    });

    it('no leading newline when file is empty', () => {
      const append = buildGitignoreAppend('', ['.ai/agents/']);
      expect(append).not.toMatch(/^\n\n# Wisp/);
      expect(append).toContain('# Wisp AI');
    });
  });
});
