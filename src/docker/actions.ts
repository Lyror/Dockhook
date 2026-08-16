import type { ActionResult } from '../types.js';
import type { RunFn } from '../exec.js';
import { tail } from '../exec.js';
import type { Logger } from '../log.js';
import { parseTemplate } from './template.js';
import { buildRunArgs } from './args.js';

export interface DockerDeps {
  run: RunFn;
  logger: Logger;
  readFile: (path: string) => Promise<string>;
  listTemplates: () => Promise<string[]>;
  wait: (ms: number) => Promise<void>;
  timeoutMs: number;
  healthCheckDelayMs: number;
  templateDir: string;
}

function combined(result: { stdout: string; stderr: string }): string {
  return tail([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

function saysNoSuchContainer(result: { stdout: string; stderr: string }): boolean {
  return /no such container/i.test(`${result.stdout}${result.stderr}`);
}

export async function restartContainer(
  deps: DockerDeps,
  containerName: string,
): Promise<ActionResult> {
  const result = await deps.run('docker', ['restart', containerName], {
    timeoutMs: deps.timeoutMs,
  });

  if (result.code !== 0) {
    deps.logger.error('container_restart_failed', {
      container: containerName,
      exitCode: result.code,
      timedOut: result.timedOut,
      output: combined(result),
    });

    const message = saysNoSuchContainer(result)
      ? `container "${containerName}" does not exist on this server — check the target mapping under Settings -> Dockhook`
      : `restarting ${containerName} failed`;

    return { ok: false, message, output: combined(result) };
  }

  deps.logger.info('container_restarted', { container: containerName });
  return { ok: true, summary: `restarted ${containerName}`, output: combined(result) };
}

export async function updateContainer(
  deps: DockerDeps,
  containerName: string,
): Promise<ActionResult> {
  // Unraid names user templates with a "my-" prefix, e.g. my-MyApp.xml.
  const templatePath = `${deps.templateDir}/my-${containerName}.xml`;

  let xml: string;
  try {
    xml = await deps.readFile(templatePath);
  } catch (cause) {
    // Nearly always a typo in the target mapping, so name what was expected and
    // what exists instead of surfacing a bare ENOENT.
    const known = await deps.listTemplates().catch(() => []);
    deps.logger.error('template_unreadable', { container: containerName, templatePath });
    return {
      ok: false,
      message: `no unraid template found for container "${containerName}" — check the target mapping under Settings -> Dockhook`,
      output: [
        `expected: ${templatePath}`,
        `reason: ${String(cause)}`,
        known.length > 0
          ? `containers with a template: ${known.join(', ')}`
          : 'no container templates found at all',
      ].join('\n'),
    };
  }

  let template;
  try {
    template = parseTemplate(xml);
  } catch (cause) {
    deps.logger.error('template_invalid', { container: containerName, templatePath });
    return {
      ok: false,
      message: `template for ${containerName} is invalid`,
      output: String(cause),
    };
  }

  // Recorded up front so a failed recreate can be rolled back by hand. The old
  // image is never deleted, so this id stays resolvable.
  const inspect = await deps.run(
    'docker',
    ['inspect', '--format', '{{.Image}}', containerName],
    { timeoutMs: deps.timeoutMs },
  );
  const previousImage = inspect.code === 0 ? inspect.stdout.trim() : 'unknown';

  const pull = await deps.run('docker', ['pull', template.repository], {
    timeoutMs: deps.timeoutMs,
  });
  if (pull.code !== 0) {
    // Nothing has been torn down yet, so the running container is untouched.
    deps.logger.error('image_pull_failed', {
      container: containerName,
      image: template.repository,
      exitCode: pull.code,
      timedOut: pull.timedOut,
      output: combined(pull),
    });
    // A private registry such as Nexus needs credentials from a prior
    // `docker login`; that is by far the most common cause here.
    const unauthorized = /unauthorized|authentication required|denied/i.test(
      `${pull.stdout}${pull.stderr}`,
    );

    return {
      ok: false,
      message: unauthorized
        ? `pulling ${template.repository} was denied — run "docker login" for that registry on the Unraid host; ${containerName} left untouched`
        : `pulling ${template.repository} failed, ${containerName} left untouched`,
      output: combined(pull),
    };
  }

  // A missing container is fine here: this may be the first deploy. Any other
  // failure means the old container may still exist — and still be running —
  // so it would be wrong to proceed to `docker run` and later report it as
  // "removed and not running".
  const stop = await deps.run('docker', ['stop', containerName], { timeoutMs: deps.timeoutMs });
  if (stop.code !== 0 && !saysNoSuchContainer(stop)) {
    deps.logger.error('container_update_removal_failed', {
      container: containerName,
      step: 'stop',
      exitCode: stop.code,
      timedOut: stop.timedOut,
      output: combined(stop),
    });
    return {
      ok: false,
      message: `${containerName} could not be stopped/removed — it may still be running; nothing was recreated`,
      output: combined(stop),
    };
  }

  const rm = await deps.run('docker', ['rm', containerName], { timeoutMs: deps.timeoutMs });
  if (rm.code !== 0 && !saysNoSuchContainer(rm)) {
    deps.logger.error('container_update_removal_failed', {
      container: containerName,
      step: 'rm',
      exitCode: rm.code,
      timedOut: rm.timedOut,
      output: combined(rm),
    });
    return {
      ok: false,
      message: `${containerName} could not be stopped/removed — it may still be running; nothing was recreated`,
      output: combined(rm),
    };
  }

  const runArgs = buildRunArgs(template);
  const created = await deps.run('docker', runArgs, { timeoutMs: deps.timeoutMs });

  if (created.code !== 0) {
    const failedCommand = ['docker', ...runArgs].join(' ');
    deps.logger.error('container_update_degraded', {
      container: containerName,
      state: 'container removed and not running',
      previousImage,
      newImage: template.repository,
      templatePath,
      failedCommand,
      exitCode: created.code,
      timedOut: created.timedOut,
      output: combined(created),
      recovery:
        'previous image was not deleted; recreate by hand from the template or run the previous image id',
    });

    return {
      ok: false,
      message: `${containerName} was removed and the new container failed to start — it is not running`,
      output: [
        `previous image: ${previousImage}`,
        `new image: ${template.repository}`,
        `template: ${templatePath}`,
        `failed command: ${failedCommand}`,
        `exit code: ${created.code}`,
        combined(created),
      ].join('\n'),
    };
  }

  // `docker run -d` returns as soon as the container is started, so a container
  // that crashes seconds later would otherwise be reported as a success.
  await deps.wait(deps.healthCheckDelayMs);
  const health = await deps.run(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', containerName],
    { timeoutMs: deps.timeoutMs },
  );

  if (health.stdout.trim() !== 'true') {
    const logs = await deps.run('docker', ['logs', '--tail', '40', containerName], {
      timeoutMs: deps.timeoutMs,
    });

    deps.logger.error('container_update_unhealthy', {
      container: containerName,
      state: 'started but no longer running',
      previousImage,
      newImage: template.repository,
      templatePath,
      containerLogs: combined(logs),
      recovery: 'previous image was not deleted; roll back by hand if needed',
    });

    return {
      ok: false,
      message: `${containerName} started but exited within ${deps.healthCheckDelayMs}ms — it is not running`,
      output: [
        `previous image: ${previousImage}`,
        `new image: ${template.repository}`,
        'container logs:',
        combined(logs),
      ].join('\n'),
    };
  }

  deps.logger.info('container_updated', {
    container: containerName,
    image: template.repository,
    previousImage,
  });

  return {
    ok: true,
    summary: `updated ${containerName} to ${template.repository}`,
    output: combined(created),
  };
}
