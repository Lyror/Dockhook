import { describe, expect, it } from 'vitest';
import { createLogger } from './log.js';

describe('createLogger', () => {
  it('writes one JSON line per event with level, event and fields', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info('deploy_started', { target: 'myapp', action: 'restart_container' });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('deploy_started');
    expect(parsed.target).toBe('myapp');
    expect(parsed.action).toBe('restart_container');
    expect(typeof parsed.time).toBe('string');
  });

  it('marks error events with level error', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.error('update_failed', { target: 'myapp' });

    expect(JSON.parse(lines[0]!).level).toBe('error');
  });

  it('appends a newline so lines can be tailed', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info('ping', {});

    expect(lines[0]!.endsWith('\n')).toBe(true);
  });
});
