import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer, type Executor } from './server.js';
import { parseConfig } from '../config.js';
import { createLogger } from '../log.js';
import { TargetLocks } from '../lock.js';

const TOKEN = 'a-very-long-secret-token-value';

const config = parseConfig(
  { TOKEN },
  {
    myapp: { KIND: 'container', NAME: 'MyApp' },
    backup: { KIND: 'script', ID: 'nightly-backup' },
    slow: { KIND: 'script', ID: 'slow-backup', TIMEOUT_MS: '1200000' },
  },
);

function makeExecutor(): Executor {
  return {
    updateContainer: vi.fn(async () => ({ ok: true as const, summary: 'updated', output: '' })),
    restartContainer: vi.fn(async () => ({ ok: true as const, summary: 'restarted', output: '' })),
    runUserScript: vi.fn(async () => ({ ok: true as const, summary: 'ran', output: '' })),
  };
}

let executor: Executor;
let lines: string[];

function makeServer() {
  return buildServer({
    config,
    logger: createLogger((line) => lines.push(line)),
    locks: new TargetLocks(),
    executor,
  });
}

beforeEach(() => {
  executor = makeExecutor();
  lines = [];
});

describe('GET /health', () => {
  it('answers 200 without a token', async () => {
    const response = await makeServer().inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /deploy authentication', () => {
  it('rejects a missing token with 401', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      payload: { action: 'restart_container', target: 'myapp' },
    });
    expect(response.statusCode).toBe(401);
    expect(executor.restartContainer).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with 401', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: { 'x-webhook-token': 'wrong-but-long-enough-token' },
      payload: { action: 'restart_container', target: 'myapp' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /deploy validation', () => {
  const auth = { 'x-webhook-token': TOKEN };

  it('rejects an unknown action with 400', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'delete_everything', target: 'myapp' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown target with 400', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(executor.restartContainer).not.toHaveBeenCalled();
  });

  it('rejects an action that does not match the target kind with 400', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'run_userscript', target: 'myapp' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing target with 400', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /deploy dispatch', () => {
  const auth = { 'x-webhook-token': TOKEN };

  it('maps update_container to the executor with the configured container name', async () => {
    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'update_container', target: 'myapp' },
    });
    expect(response.statusCode).toBe(200);
    expect(executor.updateContainer).toHaveBeenCalledWith('MyApp', 600000);
  });

  it('maps restart_container to the executor', async () => {
    await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });
    expect(executor.restartContainer).toHaveBeenCalledWith('MyApp', 600000);
  });

  it('maps run_userscript to the executor with the configured script id', async () => {
    await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'run_userscript', target: 'backup' },
    });
    expect(executor.runUserScript).toHaveBeenCalledWith('nightly-backup', 600000);
  });

  it('passes a per-target TIMEOUT_MS override to the executor instead of the global default', async () => {
    await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'run_userscript', target: 'slow' },
    });
    expect(executor.runUserScript).toHaveBeenCalledWith('slow-backup', 1200000);
  });

  it('returns 500 with the output when the action fails', async () => {
    executor.restartContainer = vi.fn(async () => ({
      ok: false as const,
      message: 'restart failed',
      output: 'No such container',
    }));

    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().output).toContain('No such container');
  });

  it('returns 409 when the same target is already busy', async () => {
    const locks = new TargetLocks();
    locks.tryAcquire('myapp');

    const server = buildServer({
      config,
      logger: createLogger((line) => lines.push(line)),
      locks,
      executor,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });

    expect(response.statusCode).toBe(409);
    expect(executor.restartContainer).not.toHaveBeenCalled();
  });

  it('releases the lock after the action finishes', async () => {
    const server = makeServer();
    const request = {
      method: 'POST' as const,
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    };

    await server.inject(request);
    const second = await server.inject(request);

    expect(second.statusCode).toBe(200);
  });

  it('releases the lock even when the executor throws', async () => {
    executor.restartContainer = vi.fn(async () => {
      throw new Error('boom');
    });

    const server = makeServer();
    const request = {
      method: 'POST' as const,
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    };

    const first = await server.inject(request);
    expect(first.statusCode).toBe(500);

    const second = await server.inject(request);
    expect(second.statusCode).not.toBe(409);
  });

  it('logs every accepted request with action and target', async () => {
    await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });

    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'deploy_requested');
    expect(entry.action).toBe('restart_container');
    expect(entry.target).toBe('myapp');
  });

  it('logs target_busy with the ip on the 409 path', async () => {
    const locks = new TargetLocks();
    locks.tryAcquire('myapp');

    const server = buildServer({
      config,
      logger: createLogger((line) => lines.push(line)),
      locks,
      executor,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });

    expect(response.statusCode).toBe(409);
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'target_busy');
    expect(entry).toBeDefined();
    expect(entry.target).toBe('myapp');
    expect(entry.ip).toBeDefined();
  });

  it('releases the lock even when logger.info throws for deploy_requested', async () => {
    const locks = new TargetLocks();
    const throwingLogger = {
      info: vi.fn((event: string, fields: Record<string, unknown>) => {
        if (event === 'deploy_requested') throw new Error('disk full');
        lines.push(JSON.stringify({ event, ...fields }));
      }),
      error: vi.fn((event: string, fields: Record<string, unknown>) => {
        lines.push(JSON.stringify({ event, ...fields }));
      }),
    };

    const server = buildServer({
      config,
      logger: throwingLogger,
      locks,
      executor,
    });

    const request = {
      method: 'POST' as const,
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    };

    // The first request's logger.info throws; the handler must still release
    // the lock so a second request for the same target is not stuck at 409.
    await server.inject(request);

    const second = await server.inject(request);
    expect(second.statusCode).not.toBe(409);
  });
});

describe('POST /deploy with async: true', () => {
  const auth = { 'x-webhook-token': TOKEN };

  it('returns 202 with an accepted status instead of waiting for the result', async () => {
    let resolveAction!: (result: { ok: true; summary: string; output: string }) => void;
    executor.restartContainer = vi.fn(
      () =>
        new Promise<{ ok: true; summary: string; output: string }>((resolve) => {
          resolveAction = resolve;
        }),
    );

    const response = await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp', async: true },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'accepted',
      action: 'restart_container',
      target: 'myapp',
    });

    // Clean up the still-pending executor call so it doesn't leak into other tests.
    resolveAction({ ok: true, summary: 'restarted', output: '' });
  });

  it('still enforces the lock: a busy target returns 409 and never calls the executor', async () => {
    const locks = new TargetLocks();
    locks.tryAcquire('myapp');

    const server = buildServer({
      config,
      logger: createLogger((line) => lines.push(line)),
      locks,
      executor,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp', async: true },
    });

    expect(response.statusCode).toBe(409);
    expect(executor.restartContainer).not.toHaveBeenCalled();
  });

  it('logs deploy_async_finished once the background action completes', async () => {
    await makeServer().inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp', async: true },
    });

    // The response returns before the background action settles; flush microtasks.
    await new Promise((resolve) => setImmediate(resolve));

    const entry = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.event === 'deploy_async_finished');
    expect(entry).toBeDefined();
    expect(entry.ok).toBe(true);
    expect(entry.action).toBe('restart_container');
    expect(entry.target).toBe('myapp');
  });

  it('releases the lock once the background action completes', async () => {
    const server = makeServer();

    await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp', async: true },
    });

    // Give the detached background execution a chance to finish and release the lock.
    await new Promise((resolve) => setImmediate(resolve));

    const second = await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });

    expect(second.statusCode).toBe(200);
  });

  it('logs deploy_crashed and still releases the lock when the background action throws', async () => {
    executor.restartContainer = vi.fn(async () => {
      throw new Error('boom');
    });

    const server = makeServer();

    await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp', async: true },
    });

    await new Promise((resolve) => setImmediate(resolve));

    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'deploy_crashed');
    expect(entry).toBeDefined();

    const second = await server.inject({
      method: 'POST',
      url: '/deploy',
      headers: auth,
      payload: { action: 'restart_container', target: 'myapp' },
    });
    expect(second.statusCode).not.toBe(409);
  });
});
