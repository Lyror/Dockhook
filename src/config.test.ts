import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig, resolveTarget } from './config.js';

const settings = {
  TOKEN: 'a-very-long-secret-token-value',
  PORT: '8377',
  BIND_ADDRESS: '0.0.0.0',
  ACTION_TIMEOUT_MS: '600000',
};

const targets = {
  myapp: { KIND: 'container', NAME: 'MyApp' },
  backup: { KIND: 'script', ID: 'nightly-backup' },
};

describe('parseConfig', () => {
  it('accepts a valid config', () => {
    const config = parseConfig(settings, targets);
    expect(config.port).toBe(8377);
    expect(config.targets['myapp']).toEqual({ kind: 'container', name: 'MyApp' });
    expect(config.targets['backup']).toEqual({ kind: 'script', id: 'nightly-backup' });
  });

  it('rejects a missing token', () => {
    const { TOKEN, ...rest } = settings;
    expect(() => parseConfig(rest, {})).toThrow(ConfigError);
  });

  it('rejects a token shorter than 16 characters', () => {
    expect(() => parseConfig({ ...settings, TOKEN: 'short' }, {})).toThrow(/16/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseConfig({ ...settings, PORT: 'abc' }, {})).toThrow(/port/i);
  });

  it('rejects a port out of range', () => {
    expect(() => parseConfig({ ...settings, PORT: '70000' }, {})).toThrow(/port/i);
  });

  it('rejects an unknown target kind', () => {
    expect(() => parseConfig(settings, { x: { KIND: 'vm', NAME: 'y' } })).toThrow(ConfigError);
  });

  it('rejects a container target without a name', () => {
    expect(() => parseConfig(settings, { x: { KIND: 'container' } })).toThrow(ConfigError);
  });

  it('rejects a container name containing a path separator', () => {
    expect(() =>
      parseConfig(settings, { x: { KIND: 'container', NAME: '../escape' } }),
    ).toThrow(/name/i);
  });

  it('rejects a script id containing a path separator', () => {
    expect(() => parseConfig(settings, { x: { KIND: 'script', ID: '../escape' } })).toThrow(
      /id/i,
    );
  });

  it('rejects a target key containing a path separator', () => {
    expect(() =>
      parseConfig(settings, { '../x': { KIND: 'script', ID: 'ok' } }),
    ).toThrow(ConfigError);
  });

  it('applies defaults for port, bind address and timeout', () => {
    const config = parseConfig({ TOKEN: 'a-very-long-secret-token-value' }, {});
    expect(config.port).toBe(8377);
    expect(config.bindAddress).toBe('0.0.0.0');
    expect(config.actionTimeoutMs).toBe(600000);
  });

  it('accepts an empty targets file', () => {
    expect(parseConfig(settings, {}).targets).toEqual({});
  });
});

describe('resolveTarget', () => {
  const config = parseConfig(settings, targets);

  it('resolves a container target for update_container', () => {
    expect(resolveTarget(config, 'update_container', 'myapp')).toEqual({
      kind: 'container',
      name: 'MyApp',
    });
  });

  it('resolves a container target for restart_container', () => {
    expect(resolveTarget(config, 'restart_container', 'myapp')).not.toBeNull();
  });

  it('resolves a script target for run_userscript', () => {
    expect(resolveTarget(config, 'run_userscript', 'backup')).toEqual({
      kind: 'script',
      id: 'nightly-backup',
    });
  });

  it('returns null when the action does not match the target kind', () => {
    expect(resolveTarget(config, 'run_userscript', 'myapp')).toBeNull();
    expect(resolveTarget(config, 'update_container', 'backup')).toBeNull();
  });

  it('returns null for an unknown target', () => {
    expect(resolveTarget(config, 'update_container', 'nope')).toBeNull();
  });
});
