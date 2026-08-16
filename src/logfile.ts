import { appendFileSync, renameSync, statSync } from 'node:fs';

export interface LogFileOps {
  size(path: string): number;
  append(path: string, line: string): void;
  rename(from: string, to: string): void;
}

export const realOps: LogFileOps = {
  size: (path) => statSync(path).size,
  append: (path, line) => appendFileSync(path, line),
  rename: (from, to) => renameSync(from, to),
};

export interface RotatingWriterOptions {
  path: string;
  maxBytes: number;
  ops?: LogFileOps;
}

export function createRotatingWriter(options: RotatingWriterOptions): (line: string) => void {
  const { path, maxBytes, ops = realOps } = options;

  return (line: string) => {
    try {
      // One generation is enough here: the log is a troubleshooting aid, and
      // /var/log lives in RAM, so keeping more would defeat the purpose.
      if (ops.size(path) > maxBytes) ops.rename(path, `${path}.1`);
    } catch {
      // No log file yet, or it vanished — appending recreates it.
    }
    try {
      ops.append(path, line);
    } catch {
      // Logging must never crash the caller (e.g. a hung lock on ENOSPC), and
      // there is nowhere better to report a logging failure that isn't circular.
    }
  };
}
