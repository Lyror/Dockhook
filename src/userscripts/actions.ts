import type { ActionResult } from '../types.js';
import type { RunFn } from '../exec.js';
import { tail } from '../exec.js';
import type { Logger } from '../log.js';

export interface ScriptDeps {
  run: RunFn;
  logger: Logger;
  exists: (path: string) => Promise<boolean>;
  timeoutMs: number;
  scriptDir: string;
}

export async function runUserScript(
  deps: ScriptDeps,
  scriptId: string,
): Promise<ActionResult> {
  const scriptPath = `${deps.scriptDir}/${scriptId}/script`;

  if (!(await deps.exists(scriptPath))) {
    deps.logger.error('userscript_missing', { script: scriptId, scriptPath });
    return {
      ok: false,
      message: `user script "${scriptId}" not found`,
      output: scriptPath,
    };
  }

  const result = await deps.run('bash', [scriptPath], { timeoutMs: deps.timeoutMs });
  const output = tail([result.stdout, result.stderr].filter(Boolean).join('\n'));

  if (result.timedOut) {
    deps.logger.error('userscript_failed', {
      script: scriptId,
      exitCode: result.code,
      timedOut: true,
      output,
    });
    return {
      ok: false,
      message: `user script "${scriptId}" timed out after ${deps.timeoutMs}ms`,
      output,
    };
  }

  if (result.code !== 0) {
    deps.logger.error('userscript_failed', {
      script: scriptId,
      exitCode: result.code,
      timedOut: false,
      output,
    });
    return {
      ok: false,
      message: `user script "${scriptId}" failed with exit code ${result.code}`,
      output,
    };
  }

  deps.logger.info('userscript_finished', { script: scriptId });
  return { ok: true, summary: `ran user script "${scriptId}"`, output };
}
