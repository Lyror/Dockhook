import { describe, expect, it } from 'vitest';
import { buildRunArgs } from './args.js';
import type { ParsedTemplate } from './template.js';

const base: ParsedTemplate = {
  name: 'myapp',
  repository: 'nexus.example.com/myapp:latest',
  network: 'bridge',
  privileged: false,
  volumes: [],
  ports: [],
  variables: [],
  devices: [],
  labels: [],
};

describe('buildRunArgs', () => {
  it('starts with run -d and names the container', () => {
    const args = buildRunArgs(base);
    expect(args.slice(0, 2)).toEqual(['run', '-d']);
    expect(args).toContain('--name');
    expect(args[args.indexOf('--name') + 1]).toBe('myapp');
  });

  it('puts the image last when there are no post args', () => {
    expect(buildRunArgs(base).at(-1)).toBe('nexus.example.com/myapp:latest');
  });

  it('always marks the container as managed by dockerman', () => {
    const args = buildRunArgs(base);
    expect(args).toContain('net.unraid.docker.managed=dockerman');
  });

  it('sets the network', () => {
    const args = buildRunArgs(base);
    expect(args[args.indexOf('--net') + 1]).toBe('bridge');
  });

  it('adds --privileged only when the template says so', () => {
    expect(buildRunArgs(base)).not.toContain('--privileged');
    expect(buildRunArgs({ ...base, privileged: true })).toContain('--privileged');
  });

  it('maps volumes to -v host:container:mode', () => {
    const args = buildRunArgs({
      ...base,
      volumes: [{ hostPath: '/mnt/user/appdata/myapp', containerPath: '/app/data', mode: 'rw' }],
    });
    expect(args[args.indexOf('-v') + 1]).toBe('/mnt/user/appdata/myapp:/app/data:rw');
  });

  it('maps ports to -p host:container/protocol', () => {
    const args = buildRunArgs({
      ...base,
      ports: [{ hostPort: '18080', containerPort: '8080', protocol: 'tcp' }],
    });
    expect(args[args.indexOf('-p') + 1]).toBe('18080:8080/tcp');
  });

  it('omits port mappings when the network is host', () => {
    const args = buildRunArgs({
      ...base,
      network: 'host',
      ports: [{ hostPort: '18080', containerPort: '8080', protocol: 'tcp' }],
    });
    expect(args).not.toContain('-p');
  });

  it('maps variables to -e NAME=value', () => {
    const args = buildRunArgs({
      ...base,
      variables: [{ name: 'TZ', value: 'Europe/Berlin' }],
    });
    expect(args[args.indexOf('-e') + 1]).toBe('TZ=Europe/Berlin');
  });

  it('maps devices to --device', () => {
    const args = buildRunArgs({ ...base, devices: [{ hostPath: '/dev/dri' }] });
    expect(args[args.indexOf('--device') + 1]).toBe('/dev/dri');
  });

  it('maps template labels to -l NAME=value', () => {
    const args = buildRunArgs({
      ...base,
      labels: [{ name: 'app.tier', value: 'backend' }],
    });
    expect(args).toContain('app.tier=backend');
  });

  it('adds the icon as an unraid label', () => {
    const args = buildRunArgs({ ...base, icon: 'https://example.com/i.png' });
    expect(args).toContain('net.unraid.docker.icon=https://example.com/i.png');
  });

  it('adds the webui as an unraid label so the gui link survives', () => {
    const args = buildRunArgs({ ...base, webUi: 'http://[IP]:[PORT:8080]/' });
    expect(args).toContain('net.unraid.docker.webui=http://[IP]:[PORT:8080]/');
  });

  it('sets a fixed ip on a custom network', () => {
    const args = buildRunArgs({ ...base, network: 'br0', myIp: '192.168.1.50' });
    expect(args[args.indexOf('--ip') + 1]).toBe('192.168.1.50');
  });

  it('omits a fixed ip on the bridge and host networks', () => {
    expect(buildRunArgs({ ...base, network: 'bridge', myIp: '192.168.1.50' })).not.toContain('--ip');
    expect(buildRunArgs({ ...base, network: 'host', myIp: '192.168.1.50' })).not.toContain('--ip');
  });

  it('sets cpuset when present', () => {
    const args = buildRunArgs({ ...base, cpuset: '0,1' });
    expect(args[args.indexOf('--cpuset-cpus') + 1]).toBe('0,1');
  });

  it('splits extra params on whitespace and places them before the image', () => {
    const args = buildRunArgs({ ...base, extraParams: '--restart unless-stopped' });
    const imageIndex = args.indexOf('nexus.example.com/myapp:latest');
    expect(args.indexOf('--restart')).toBeLessThan(imageIndex);
    expect(args[args.indexOf('--restart') + 1]).toBe('unless-stopped');
  });

  it('places post args after the image', () => {
    const args = buildRunArgs({ ...base, postArgs: '--verbose --dry-run' });
    const imageIndex = args.indexOf('nexus.example.com/myapp:latest');
    expect(args.slice(imageIndex + 1)).toEqual(['--verbose', '--dry-run']);
  });
});
