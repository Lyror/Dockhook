import { describe, expect, it, vi } from 'vitest';
import { restartContainer, updateContainer, type DockerDeps } from './actions.js';
import { createLogger } from '../log.js';
import type { ExecResult } from '../exec.js';

const TEMPLATE = `<?xml version="1.0"?>
<Container version="2">
  <Name>myapp</Name>
  <Repository>nexus.example.com/myapp:latest</Repository>
  <Network>bridge</Network>
</Container>`;

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false });
const fail = (stderr: string): ExecResult => ({ code: 1, stdout: '', stderr, timedOut: false });

function makeDeps(
  runImpl: (command: string, args: string[]) => ExecResult,
  lines: string[] = [],
): DockerDeps {
  return {
    run: vi.fn(async (command: string, args: string[]) => runImpl(command, args)),
    logger: createLogger((line) => lines.push(line)),
    // Templates end in .xml; the unraid update-status cache (a separate,
    // unrelated file) defaults to "not present" unless a test overrides it.
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('.xml')) return TEMPLATE;
      throw new Error('ENOENT');
    }),
    writeFile: vi.fn(async () => {}),
    listTemplates: vi.fn(async () => ['myapp', 'other-app']),
    wait: vi.fn(async () => {}),
    timeoutMs: 5000,
    healthCheckDelayMs: 3000,
    templateDir: '/boot/config/plugins/dockerMan/templates-user',
  };
}

// docker inspect --format '{{.State.Running}}' answers the health check.
const running = (value: string): ExecResult => ({
  code: 0,
  stdout: `${value}\n`,
  stderr: '',
  timedOut: false,
});

// Default: image inspect returns the old id, health inspect reports running.
function happyPath(_command: string, args: string[]): ExecResult {
  if (args[0] === 'inspect' && args[2] === '{{.State.Running}}') return running('true');
  if (args[0] === 'inspect') return ok('sha256:old');
  return ok();
}

describe('updateContainer', () => {
  it('pulls, stops, removes, recreates and health checks the container', async () => {
    const calls: string[][] = [];
    const deps = makeDeps((command, args) => {
      calls.push(args);
      return happyPath(command, args);
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(calls.map((a) => a[0])).toEqual([
      'inspect',
      'pull',
      'stop',
      'rm',
      'run',
      'inspect',
    ]);
  });

  it('reads the template for the given container name', async () => {
    const deps = makeDeps(happyPath);
    await updateContainer(deps, 'myapp');
    expect(deps.readFile).toHaveBeenCalledWith(
      '/boot/config/plugins/dockerMan/templates-user/my-myapp.xml',
    );
  });

  it('names the expected template file when it is missing', async () => {
    const deps = makeDeps(happyPath);
    deps.readFile = vi.fn(async () => {
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'typo');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no unraid template/i);
      expect(result.message).toContain('typo');
      expect(result.output).toContain('my-typo.xml');
    }
  });

  it('lists the containers it does know about when the template is missing', async () => {
    const deps = makeDeps(happyPath);
    deps.readFile = vi.fn(async () => {
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'typo');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.output).toContain('myapp');
      expect(result.output).toContain('other-app');
    }
  });

  it('does not execute docker at all when the template is missing', async () => {
    const deps = makeDeps(happyPath);
    deps.readFile = vi.fn(async () => {
      throw new Error('ENOENT');
    });

    await updateContainer(deps, 'typo');

    expect(deps.run).not.toHaveBeenCalled();
  });

  it('leaves the old container running when the pull fails', async () => {
    const calls: string[][] = [];
    const deps = makeDeps((command, args) => {
      calls.push(args);
      return args[0] === 'pull' ? fail('manifest unknown') : happyPath(command, args);
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    expect(calls.map((a) => a[0])).toEqual(['inspect', 'pull']);
    expect(calls.map((a) => a[0])).not.toContain('rm');
  });

  it('explains that credentials may be missing when the pull is unauthorized', async () => {
    const deps = makeDeps((command, args) =>
      args[0] === 'pull' ? fail('unauthorized: authentication required') : happyPath(command, args),
    );

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/docker login/i);
  });

  it('logs a degraded state when recreating fails after removal', async () => {
    const lines: string[] = [];
    const deps = makeDeps(
      (command, args) =>
        args[0] === 'run' ? fail('port already allocated') : happyPath(command, args),
      lines,
    );

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    const degraded = lines
      .map((line) => JSON.parse(line))
      .find((entry) => entry.event === 'container_update_degraded');

    expect(degraded).toBeDefined();
    expect(degraded.level).toBe('error');
    expect(degraded.container).toBe('myapp');
    expect(degraded.previousImage).toBe('sha256:old');
    expect(degraded.templatePath).toBe(
      '/boot/config/plugins/dockerMan/templates-user/my-myapp.xml',
    );
    expect(degraded.failedCommand).toContain('docker run');
    expect(degraded.exitCode).toBe(1);
    expect(degraded.output).toContain('port already allocated');
  });

  it('tells the caller the container is down when recreating fails', async () => {
    const deps = makeDeps((command, args) =>
      args[0] === 'run' ? fail('port already allocated') : happyPath(command, args),
    );

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not running/i);
      expect(result.output).toContain('sha256:old');
    }
  });

  it('does not recreate when rm fails for a reason other than a missing container', async () => {
    const lines: string[] = [];
    const calls: string[][] = [];
    const deps = makeDeps((command, args) => {
      calls.push(args);
      if (args[0] === 'rm') return fail('Error response from daemon: container is running');
      return happyPath(command, args);
    }, lines);

    const result = await updateContainer(deps, 'myapp');

    expect(calls.map((a) => a[0])).not.toContain('run');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/was removed/i);
      expect(result.message).not.toMatch(/it is not running/i);
      expect(result.message).toMatch(/may still be running/i);
    }

    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'container_update_removal_failed');
    expect(entry).toBeDefined();
    expect(entry.level).toBe('error');
    expect(entry.container).toBe('myapp');
    expect(entry.step).toBe('rm');
    expect(entry.exitCode).toBe(1);
    expect(entry.output).toContain('container is running');
  });

  it('does not recreate when stop fails for a reason other than a missing container', async () => {
    const lines: string[] = [];
    const calls: string[][] = [];
    const deps = makeDeps((command, args) => {
      calls.push(args);
      if (args[0] === 'stop') return fail('Error response from daemon: timeout');
      return happyPath(command, args);
    }, lines);

    const result = await updateContainer(deps, 'myapp');

    expect(calls.map((a) => a[0])).not.toContain('rm');
    expect(calls.map((a) => a[0])).not.toContain('run');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/was removed/i);
      expect(result.message).toMatch(/may still be running/i);
    }

    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'container_update_removal_failed');
    expect(entry).toBeDefined();
    expect(entry.step).toBe('stop');
  });

  it('waits before the health check', async () => {
    const deps = makeDeps(happyPath);
    await updateContainer(deps, 'myapp');
    expect(deps.wait).toHaveBeenCalledWith(3000);
  });

  it('fails when the container is no longer running shortly after start', async () => {
    const lines: string[] = [];
    const deps = makeDeps((command, args) => {
      if (args[0] === 'inspect' && args[2] === '{{.State.Running}}') return running('false');
      if (args[0] === 'logs') return ok('panic: cannot bind socket');
      return happyPath(command, args);
    }, lines);

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/exited/i);
      expect(result.output).toContain('panic: cannot bind socket');
    }
    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'container_update_unhealthy');
    expect(entry.level).toBe('error');
  });

  it('never removes the previous image', async () => {
    const calls: string[][] = [];
    const deps = makeDeps((command, args) => {
      calls.push(args);
      return happyPath(command, args);
    });

    await updateContainer(deps, 'myapp');

    const subcommands = calls.map((a) => a[0]);
    expect(subcommands).not.toContain('rmi');
    expect(subcommands).not.toContain('prune');
  });

  it('refuses to run when the template <Name> differs from the requested container', async () => {
    const lines: string[] = [];
    const deps = makeDeps(happyPath, lines);
    deps.readFile = vi.fn(async () => `<?xml version="1.0"?>
<Container version="2">
  <Name>otherapp</Name>
  <Repository>nexus.example.com/myapp:latest</Repository>
  <Network>bridge</Network>
</Container>`);

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('myapp');
      expect(result.message).toContain('otherapp');
    }
    expect(deps.run).not.toHaveBeenCalled();

    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'template_name_mismatch');
    expect(entry).toBeDefined();
    expect(entry.level).toBe('error');
    expect(entry.container).toBe('myapp');
    expect(entry.templateName).toBe('otherapp');
  });

  it('succeeds on a first deploy where the container does not exist yet', async () => {
    const deps = makeDeps((command, args) => {
      if (args[0] === 'inspect' && args[2] === '{{.State.Running}}') return running('true');
      if (args[0] === 'inspect' || args[0] === 'stop' || args[0] === 'rm') {
        return fail('No such container');
      }
      return happyPath(command, args);
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
  });

  const UNRAID_UPDATE_STATUS_PATH = '/var/lib/docker/unraid-update-status.json';

  it('removes the stale entry from the unraid update-status cache after a successful update', async () => {
    const lines: string[] = [];
    const deps = makeDeps(happyPath, lines);
    const cache = {
      'nexus.example.com/myapp:latest': { local: 'sha256:old', remote: 'sha256:new', status: 'false' },
      'other/thing:latest': { local: 'sha256:unrelated', remote: 'sha256:unrelated', status: 'true' },
    };
    deps.readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.xml')) return TEMPLATE;
      if (path === UNRAID_UPDATE_STATUS_PATH) return JSON.stringify(cache);
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContents] = (deps.writeFile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string];
    expect(writtenPath).toBe(UNRAID_UPDATE_STATUS_PATH);
    expect(JSON.parse(writtenContents)).toEqual({
      'other/thing:latest': { local: 'sha256:unrelated', remote: 'sha256:unrelated', status: 'true' },
    });

    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'unraid_update_cache_cleared');
    expect(entry).toBeDefined();
    expect(entry.container).toBe('myapp');
  });

  it('leaves the unraid update-status cache untouched when no entry matches the previous image', async () => {
    const deps = makeDeps(happyPath);
    deps.readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.xml')) return TEMPLATE;
      if (path === UNRAID_UPDATE_STATUS_PATH) {
        return JSON.stringify({ 'other/thing:latest': { local: 'sha256:x', remote: 'sha256:x', status: 'true' } });
      }
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('does not touch the unraid update-status cache when the file does not exist', async () => {
    const deps = makeDeps(happyPath);

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('does not touch the unraid update-status cache when the previous image is unknown', async () => {
    const deps = makeDeps((command, args) => {
      if (args[0] === 'inspect' && args[2] === '{{.State.Running}}') return running('true');
      if (args[0] === 'inspect') return fail('No such container');
      return happyPath(command, args);
    });
    deps.readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.xml')) return TEMPLATE;
      if (path === UNRAID_UPDATE_STATUS_PATH) {
        return JSON.stringify({ 'x/y:latest': { local: 'unknown', remote: 'sha256:x', status: 'true' } });
      }
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('logs but does not fail the update when the update-status cache is malformed JSON', async () => {
    const lines: string[] = [];
    const deps = makeDeps(happyPath, lines);
    deps.readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.xml')) return TEMPLATE;
      if (path === UNRAID_UPDATE_STATUS_PATH) return 'not json {{{';
      throw new Error('ENOENT');
    });

    const result = await updateContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(deps.writeFile).not.toHaveBeenCalled();

    const entry = lines
      .map((line) => JSON.parse(line))
      .find((e) => e.event === 'unraid_update_cache_parse_failed');
    expect(entry).toBeDefined();
  });
});

describe('restartContainer', () => {
  it('runs docker restart and reports success', async () => {
    const calls: string[][] = [];
    const deps = makeDeps((_command, args) => {
      calls.push(args);
      return ok();
    });

    const result = await restartContainer(deps, 'myapp');

    expect(result.ok).toBe(true);
    expect(calls).toEqual([['restart', 'myapp']]);
  });

  it('says the container does not exist rather than echoing docker', async () => {
    const deps = makeDeps(() => fail('Error: No such container: myapp'));

    const result = await restartContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/does not exist/i);
      expect(result.message).toContain('myapp');
    }
  });

  it('reports other failures with the docker output', async () => {
    const deps = makeDeps(() => fail('permission denied'));

    const result = await restartContainer(deps, 'myapp');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.output).toContain('permission denied');
  });

  it('does not read a template', async () => {
    const deps = makeDeps(() => ok());
    await restartContainer(deps, 'myapp');
    expect(deps.readFile).not.toHaveBeenCalled();
  });
});
