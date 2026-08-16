import { describe, expect, it } from 'vitest';
import { run, tail } from './exec.js';

describe('run', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await run('echo', ['hello'], { timeoutMs: 5000 });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.timedOut).toBe(false);
  });

  it('captures a non-zero exit code', async () => {
    const result = await run('sh', ['-c', 'exit 3'], { timeoutMs: 5000 });
    expect(result.code).toBe(3);
  });

  it('captures stderr', async () => {
    const result = await run('sh', ['-c', 'echo oops >&2'], { timeoutMs: 5000 });
    expect(result.stderr.trim()).toBe('oops');
  });

  it('kills the process and flags a timeout', async () => {
    const result = await run('sleep', ['5'], { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it('reports a non-zero code when the command does not exist', async () => {
    const result = await run('definitely-not-a-real-command-xyz', [], { timeoutMs: 5000 });
    expect(result.code).not.toBe(0);
  });

  it('passes arguments without shell interpretation', async () => {
    const result = await run('echo', ['a; rm -rf /'], { timeoutMs: 5000 });
    expect(result.stdout.trim()).toBe('a; rm -rf /');
  });
});

describe('tail', () => {
  it('returns the text unchanged when it is short', () => {
    expect(tail('one\ntwo')).toBe('one\ntwo');
  });

  it('keeps only the last N lines', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const result = tail(text, 3);
    expect(result.split('\n')).toEqual(['line97', 'line98', 'line99']);
  });
});
