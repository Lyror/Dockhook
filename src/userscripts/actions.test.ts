import { describe, expect, it, vi } from 'vitest';
import { runUserScript, type ScriptDeps } from './actions.js';
import { createLogger } from '../log.js';
import type { ExecResult } from '../exec.js';

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false });

function makeDeps(result: ExecResult, lines: string[] = [], exists = true): ScriptDeps {
  return {
    run: vi.fn(async () => result),
    logger: createLogger((line) => lines.push(line)),
    exists: vi.fn(async () => exists),
    timeoutMs: 5000,
    scriptDir: '/boot/config/plugins/user.scripts/scripts',
  };
}

describe('runUserScript', () => {
  it('executes the script at the user.scripts path with bash', async () => {
    const deps = makeDeps(ok('done'));

    const result = await runUserScript(deps, 'nightly-backup');

    expect(result.ok).toBe(true);
    expect(deps.run).toHaveBeenCalledWith(
      'bash',
      ['/boot/config/plugins/user.scripts/scripts/nightly-backup/script'],
      { timeoutMs: 5000 },
    );
  });

  it('returns the script output', async () => {
    const result = await runUserScript(makeDeps(ok('backup complete')), 'nightly-backup');
    expect(result.output).toContain('backup complete');
  });

  it('fails when the script does not exist', async () => {
    const deps = makeDeps(ok(), [], false);

    const result = await runUserScript(deps, 'missing');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('reports a non-zero exit code as a failure', async () => {
    const deps = makeDeps({ code: 2, stdout: '', stderr: 'boom', timedOut: false });

    const result = await runUserScript(deps, 'nightly-backup');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/exit code 2/);
      expect(result.output).toContain('boom');
    }
  });

  it('reports a timeout distinctly', async () => {
    const deps = makeDeps({ code: -1, stdout: '', stderr: '', timedOut: true });

    const result = await runUserScript(deps, 'nightly-backup');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/timed out/i);
  });

  it('logs success with the script id', async () => {
    const lines: string[] = [];
    await runUserScript(makeDeps(ok(), lines), 'nightly-backup');

    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'userscript_finished');
    expect(entry.script).toBe('nightly-backup');
  });

  it('logs failure at error level', async () => {
    const lines: string[] = [];
    await runUserScript(
      makeDeps({ code: 2, stdout: '', stderr: 'boom', timedOut: false }, lines),
      'nightly-backup',
    );

    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'userscript_failed');
    expect(entry.level).toBe('error');
    expect(entry.exitCode).toBe(2);
  });
});
