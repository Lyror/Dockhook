import type { ParsedTemplate } from './template.js';

function splitParams(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/\s+/).filter((part) => part.length > 0);
}

export function buildRunArgs(template: ParsedTemplate): string[] {
  const args: string[] = ['run', '-d'];

  args.push('--name', template.name);
  args.push('--net', template.network);

  if (template.privileged) args.push('--privileged');
  if (template.cpuset) args.push('--cpuset-cpus', template.cpuset);

  // A fixed address only applies to custom networks such as br0; docker rejects
  // --ip on the built-in bridge and host networks.
  if (template.myIp && template.network !== 'bridge' && template.network !== 'host') {
    args.push('--ip', template.myIp);
  }

  // Unraid's GUI only treats a container as its own when this label is present.
  args.push('-l', 'net.unraid.docker.managed=dockerman');
  if (template.icon) args.push('-l', `net.unraid.docker.icon=${template.icon}`);
  // Without this the container loses its WebUI link on the Docker tab.
  if (template.webUi) args.push('-l', `net.unraid.docker.webui=${template.webUi}`);

  for (const label of template.labels) {
    args.push('-l', `${label.name}=${label.value}`);
  }

  for (const volume of template.volumes) {
    args.push('-v', `${volume.hostPath}:${volume.containerPath}:${volume.mode}`);
  }

  // Published ports are meaningless in host networking mode and docker rejects them.
  if (template.network !== 'host') {
    for (const port of template.ports) {
      args.push('-p', `${port.hostPort}:${port.containerPort}/${port.protocol}`);
    }
  }

  for (const variable of template.variables) {
    args.push('-e', `${variable.name}=${variable.value}`);
  }

  for (const device of template.devices) {
    args.push('--device', device.hostPath);
  }

  args.push(...splitParams(template.extraParams));
  args.push(template.repository);
  args.push(...splitParams(template.postArgs));

  return args;
}
