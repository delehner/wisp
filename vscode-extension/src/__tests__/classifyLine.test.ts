import { classifyLine } from '../commands/utils';

describe('classifyLine', () => {
  it('returns "error" for lines containing " ERROR "', () => {
    expect(classifyLine('  0.123s  ERROR wisp: something failed')).toBe('error');
  });

  it('returns "error" for lines containing "error:" (case-insensitive)', () => {
    expect(classifyLine('Error: connection refused')).toBe('error');
  });

  it('returns "warn" for lines containing " WARN "', () => {
    expect(classifyLine('  0.456s  WARN wisp: retrying')).toBe('warn');
  });

  it('returns "warn" for lines containing "warning:" (case-insensitive)', () => {
    expect(classifyLine('Warning: deprecated flag used')).toBe('warn');
  });

  it('returns "debug" for lines containing " DEBUG "', () => {
    expect(classifyLine('  0.789s  DEBUG wisp: internal state')).toBe('debug');
  });

  it('returns "debug" for lines containing " TRACE "', () => {
    expect(classifyLine('  1.000s  TRACE wisp: detailed span')).toBe('debug');
  });

  it('returns "info" for plain lines with no level keyword', () => {
    expect(classifyLine('starting agent architect')).toBe('info');
  });

  it('returns "info" for lines with " INFO "', () => {
    expect(classifyLine('  0.001s  INFO wisp: starting agent')).toBe('info');
  });

  it('strips ANSI escape codes before matching', () => {
    expect(classifyLine('\x1B[31m ERROR \x1B[0m something went wrong')).toBe('error');
  });

  it('strips ANSI escape codes and falls back to info when no level keyword', () => {
    expect(classifyLine('\x1B[32mall good\x1B[0m')).toBe('info');
  });
});
