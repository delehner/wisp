import { parseEnvFile, serializeEnvFile } from '../commands/configureEnv';

describe('parseEnvFile', () => {
  it('parses key=value pairs', () => {
    const text = 'FOO=bar\nBAZ=qux';
    const result = parseEnvFile(text);
    expect(result.get('FOO')).toBe('bar');
    expect(result.get('BAZ')).toBe('qux');
  });

  it('ignores blank lines and comments', () => {
    const text = '# This is a comment\n\nFOO=bar\n  # Another comment\n';
    const result = parseEnvFile(text);
    expect(result.size).toBe(1);
    expect(result.get('FOO')).toBe('bar');
  });

  it('handles values with equals signs', () => {
    const text = 'KEY=value=with=equals';
    const result = parseEnvFile(text);
    expect(result.get('KEY')).toBe('value=with=equals');
  });

  it('trims whitespace around keys and values', () => {
    const text = '  KEY  =  value  ';
    const result = parseEnvFile(text);
    expect(result.get('KEY')).toBe('value');
  });

  it('returns empty map for empty input', () => {
    const result = parseEnvFile('');
    expect(result.size).toBe(0);
  });

  it('skips lines without equals sign', () => {
    const text = 'NOEQUALSSIGN\nGOOD=val';
    const result = parseEnvFile(text);
    expect(result.size).toBe(1);
    expect(result.get('GOOD')).toBe('val');
  });
});

describe('serializeEnvFile', () => {
  it('groups known vars by section', () => {
    const vars = new Map([
      ['ANTHROPIC_API_KEY', 'sk-ant-test'],
      ['CLAUDE_MODEL', 'sonnet'],
    ]);
    const result = serializeEnvFile(vars);
    expect(result).toContain('# Auth');
    expect(result).toContain('ANTHROPIC_API_KEY=sk-ant-test');
    expect(result).toContain('# Provider');
    expect(result).toContain('CLAUDE_MODEL=sonnet');
  });

  it('skips empty values', () => {
    const vars = new Map([
      ['ANTHROPIC_API_KEY', ''],
      ['CLAUDE_MODEL', 'sonnet'],
    ]);
    const result = serializeEnvFile(vars);
    expect(result).not.toContain('ANTHROPIC_API_KEY');
    expect(result).toContain('CLAUDE_MODEL=sonnet');
  });

  it('includes unknown keys under "Other"', () => {
    const vars = new Map([
      ['CUSTOM_VAR', 'custom_value'],
    ]);
    const result = serializeEnvFile(vars);
    expect(result).toContain('# Other');
    expect(result).toContain('CUSTOM_VAR=custom_value');
  });

  it('preserves extra keys alongside known ones', () => {
    const vars = new Map([
      ['ANTHROPIC_API_KEY', 'sk-test'],
      ['MY_CUSTOM', 'foo'],
    ]);
    const result = serializeEnvFile(vars);
    expect(result).toContain('# Auth');
    expect(result).toContain('ANTHROPIC_API_KEY=sk-test');
    expect(result).toContain('# Other');
    expect(result).toContain('MY_CUSTOM=foo');
  });

  it('ends with a newline', () => {
    const vars = new Map([['CLAUDE_MODEL', 'sonnet']]);
    const result = serializeEnvFile(vars);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('returns just a newline for empty map', () => {
    const result = serializeEnvFile(new Map());
    expect(result).toBe('\n');
  });
});
