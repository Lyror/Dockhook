import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { resolveTarget, type Config } from '../config.js';
import { ACTIONS, type Action, type ActionResult } from '../types.js';
import type { TargetLocks } from '../lock.js';
import type { Logger } from '../log.js';

export interface Executor {
  updateContainer(containerName: string): Promise<ActionResult>;
  restartContainer(containerName: string): Promise<ActionResult>;
  runUserScript(scriptId: string): Promise<ActionResult>;
}

export interface ServerOptions {
  config: Config;
  logger: Logger;
  locks: TargetLocks;
  executor: Executor;
}

function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const { config, logger, locks, executor } = options;
  const app = Fastify({ logger: false });

  app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    allowList: () => false,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/deploy', async (request, reply) => {
    if (!tokenMatches(config.token, request.headers['x-webhook-token'])) {
      logger.error('auth_rejected', { ip: request.ip });
      return reply.code(401).send({ error: 'invalid token' });
    }

    const body = request.body as Record<string, unknown> | undefined;
    const action = body?.['action'];
    const targetName = body?.['target'];

    if (!isAction(action)) {
      return reply.code(400).send({ error: 'unknown action' });
    }
    if (typeof targetName !== 'string') {
      return reply.code(400).send({ error: 'target must be a string' });
    }

    const target = resolveTarget(config, action, targetName);
    if (!target) {
      logger.error('target_rejected', { ip: request.ip, action, target: targetName });
      return reply.code(400).send({ error: 'unknown target for this action' });
    }

    if (!locks.tryAcquire(targetName)) {
      return reply.code(409).send({ error: `target "${targetName}" is busy` });
    }

    logger.info('deploy_requested', { ip: request.ip, action, target: targetName });
    const startedAt = Date.now();

    try {
      let result: ActionResult;
      if (action === 'update_container') {
        result = await executor.updateContainer((target as { name: string }).name);
      } else if (action === 'restart_container') {
        result = await executor.restartContainer((target as { name: string }).name);
      } else {
        result = await executor.runUserScript((target as { id: string }).id);
      }

      const durationMs = Date.now() - startedAt;

      if (!result.ok) {
        return reply.code(500).send({
          error: result.message,
          output: result.output,
          action,
          target: targetName,
          durationMs,
        });
      }

      return reply.code(200).send({
        status: 'ok',
        summary: result.summary,
        output: result.output,
        action,
        target: targetName,
        durationMs,
      });
    } catch (cause) {
      logger.error('deploy_crashed', { action, target: targetName, error: String(cause) });
      return reply.code(500).send({ error: 'internal error', output: String(cause) });
    } finally {
      locks.release(targetName);
    }
  });

  return app;
}
