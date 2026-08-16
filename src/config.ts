import type { Action } from './types.js';

export class ConfigError extends Error {}

export type Target =
  | { kind: 'container'; name: string }
  | { kind: 'script'; id: string };

export interface Config {
  token: string;
  port: number;
  bindAddress: string;
  actionTimeoutMs: number;
  targets: Record<string, Target>;
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function integer(
  raw: string | undefined,
  fallback: number,
  label: string,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${label} must be a whole number, got "${raw}"`);
  }
  const value = Number(raw.trim());
  if (value < min || value > max) {
    throw new ConfigError(`${label} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function parseTarget(key: string, section: Record<string, string>): Target {
  const kind = section['KIND'];

  if (kind === 'container') {
    const name = section['NAME'];
    if (!name || !SAFE_NAME.test(name)) {
      throw new ConfigError(`target "${key}": NAME must match ${SAFE_NAME.source}`);
    }
    return { kind: 'container', name };
  }

  if (kind === 'script') {
    const id = section['ID'];
    if (!id || !SAFE_NAME.test(id)) {
      throw new ConfigError(`target "${key}": ID must match ${SAFE_NAME.source}`);
    }
    return { kind: 'script', id };
  }

  throw new ConfigError(`target "${key}": KIND must be "container" or "script"`);
}

export function parseConfig(
  settings: Record<string, string>,
  rawTargets: Record<string, Record<string, string>>,
): Config {
  const token = settings['TOKEN'];
  if (typeof token !== 'string' || token.length < 16) {
    throw new ConfigError('TOKEN must be at least 16 characters');
  }

  const port = integer(settings['PORT'], 8377, 'PORT', 1, 65535);
  const actionTimeoutMs = integer(
    settings['ACTION_TIMEOUT_MS'],
    600_000,
    'ACTION_TIMEOUT_MS',
    1000,
    24 * 60 * 60 * 1000,
  );

  const bindAddress = settings['BIND_ADDRESS']?.trim() || '0.0.0.0';

  const targets: Record<string, Target> = {};
  for (const [key, section] of Object.entries(rawTargets)) {
    if (!SAFE_NAME.test(key)) {
      throw new ConfigError(`target key "${key}" must match ${SAFE_NAME.source}`);
    }
    targets[key] = parseTarget(key, section);
  }

  return { token, port, bindAddress, actionTimeoutMs, targets };
}

export function resolveTarget(
  config: Config,
  action: Action,
  targetName: string,
): Target | null {
  const target = config.targets[targetName];
  if (!target) return null;

  const wantsContainer = action === 'update_container' || action === 'restart_container';
  if (wantsContainer && target.kind !== 'container') return null;
  if (action === 'run_userscript' && target.kind !== 'script') return null;

  return target;
}
