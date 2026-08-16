import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RunFn = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<ExecResult>;

export const run: RunFn = (command, args, options) =>
  new Promise((resolve) => {
    // No shell: arguments are passed through verbatim and never re-parsed.
    const child = spawn(command, args, { shell: false });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(error), timedOut });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });

export function tail(text: string, maxLines = 40): string {
  const lines = text.split('\n');
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join('\n');
}
