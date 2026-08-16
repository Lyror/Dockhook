import { describe, expect, it } from 'vitest';
import { createRotatingWriter, type LogFileOps } from './logfile.js';

function makeOps(initialSize = 0) {
  const state = { size: initialSize, appended: [] as string[], renames: [] as string[][] };
  const ops: LogFileOps = {
    size: () => state.size,
    append: (_path, line) => {
      state.appended.push(line);
      state.size += line.length;
    },
    rename: (from, to) => {
      state.renames.push([from, to]);
      state.size = 0;
    },
  };
  return { ops, state };
}

describe('createRotatingWriter', () => {
  it('appends lines to the log file', () => {
    const { ops, state } = makeOps();
    createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('hello\n');
    expect(state.appended).toEqual(['hello\n']);
  });

  it('does not rotate while below the limit', () => {
    const { ops, state } = makeOps(100);
    createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('x\n');
    expect(state.renames).toEqual([]);
  });

  it('rotates to .1 once the limit is exceeded', () => {
    const { ops, state } = makeOps(1200);
    createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('x\n');
    expect(state.renames).toEqual([['/var/log/uw.log', '/var/log/uw.log.1']]);
  });

  it('still writes the line that triggered the rotation', () => {
    const { ops, state } = makeOps(1200);
    createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('x\n');
    expect(state.appended).toEqual(['x\n']);
  });

  it('keeps writing when the log file does not exist yet', () => {
    const ops: LogFileOps = {
      size: () => {
        throw new Error('ENOENT');
      },
      append: () => {},
      rename: () => {},
    };
    expect(() =>
      createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('x\n'),
    ).not.toThrow();
  });

  it('does not throw when append itself fails (e.g. ENOSPC)', () => {
    const { ops } = makeOps();
    ops.append = () => {
      throw new Error('ENOSPC');
    };
    expect(() =>
      createRotatingWriter({ path: '/var/log/uw.log', maxBytes: 1000, ops })('x\n'),
    ).not.toThrow();
  });
});
