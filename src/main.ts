import { access, readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger } from './log.js';
import { createRotatingWriter } from './logfile.js';
import { parseConfig, ConfigError } from './config.js';
import { parseIni, parseIniSections } from './ini.js';
import { run } from './exec.js';
import { TargetLocks } from './lock.js';
import { buildServer, type Executor } from './http/server.js';
import { restartContainer, updateContainer, type DockerDeps } from './docker/actions.js';
import { runUserScript, type ScriptDeps } from './userscripts/actions.js';

const PLUGIN_DIR = '/boot/config/plugins/dockhook';
const DEFAULTS_PATH = '/usr/local/emhttp/plugins/dockhook/default.cfg';
const SETTINGS_PATH = `${PLUGIN_DIR}/dockhook.cfg`;
const TARGETS_PATH = `${PLUGIN_DIR}/targets.cfg`;
const LOG_PATH = '/var/log/dockhook.log';
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const TEMPLATE_DIR = '/boot/config/plugins/dockerMan/templates-user';
const SCRIPT_DIR = '/boot/config/plugins/user.scripts/scripts';
const HEALTH_CHECK_DELAY_MS = 5000;

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const writeLine = createRotatingWriter({ path: LOG_PATH, maxBytes: LOG_MAX_BYTES });
  const logger = createLogger((line) => {
    writeLine(line);
    process.stdout.write(line);
  });

  let config;
  try {
    // Same precedence parse_plugin_cfg() uses: defaults first, user settings win.
    const defaults = parseIni(await readOrEmpty(DEFAULTS_PATH));
    const settings = parseIni(await readFile(SETTINGS_PATH, 'utf8'));
    const targets = parseIniSections(await readOrEmpty(TARGETS_PATH));
    config = parseConfig({ ...defaults, ...settings }, targets);
  } catch (cause) {
    const reason = cause instanceof ConfigError ? cause.message : String(cause);
    logger.error('config_invalid', { path: SETTINGS_PATH, reason });
    process.exit(1);
  }

  const dockerDeps: DockerDeps = {
    run,
    logger,
    readFile: (path) => readFile(path, 'utf8'),
    // Unraid names user templates my-<container>.xml; strip that back down to
    // the container names so a failed lookup can suggest the real ones.
    listTemplates: async () =>
      (await readdir(TEMPLATE_DIR))
        .filter((file) => file.startsWith('my-') && file.endsWith('.xml'))
        .map((file) => file.slice(3, -4))
        .sort(),
    wait: (ms) => delay(ms),
    timeoutMs: config.actionTimeoutMs,
    healthCheckDelayMs: HEALTH_CHECK_DELAY_MS,
    templateDir: TEMPLATE_DIR,
  };

  const scriptDeps: ScriptDeps = {
    run,
    logger,
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    timeoutMs: config.actionTimeoutMs,
    scriptDir: SCRIPT_DIR,
  };

  const executor: Executor = {
    updateContainer: (name) => updateContainer(dockerDeps, name),
    restartContainer: (name) => restartContainer(dockerDeps, name),
    runUserScript: (id) => runUserScript(scriptDeps, id),
  };

  const app = buildServer({ config, logger, locks: new TargetLocks(), executor });

  const shutdown = async () => {
    logger.info('shutting_down', {});
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.bindAddress, port: config.port });
  logger.info('listening', { address: config.bindAddress, port: config.port });
}

main().catch((error) => {
  process.stderr.write(`fatal: ${String(error)}\n`);
  process.exit(1);
});
