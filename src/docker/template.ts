import { XMLParser } from 'fast-xml-parser';

export class TemplateError extends Error {}

export interface TemplateVolume {
  hostPath: string;
  containerPath: string;
  mode: string;
}

export interface TemplatePort {
  hostPort: string;
  containerPort: string;
  protocol: string;
}

export interface ParsedTemplate {
  name: string;
  repository: string;
  network: string;
  privileged: boolean;
  icon?: string;
  webUi?: string;
  myIp?: string;
  extraParams?: string;
  postArgs?: string;
  cpuset?: string;
  volumes: TemplateVolume[];
  ports: TemplatePort[];
  variables: { name: string; value: string }[];
  devices: { hostPath: string }[];
  labels: { name: string; value: string }[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    const inner = (value as Record<string, unknown>)['#text'];
    return inner === undefined ? '' : String(inner).trim();
  }
  return String(value).trim();
}

function attr(node: Record<string, unknown>, name: string): string {
  const value = node[`@${name}`];
  return value === undefined ? '' : String(value).trim();
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export function parseTemplate(xml: string): ParsedTemplate {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (cause) {
    throw new TemplateError(`template is not valid xml: ${String(cause)}`);
  }

  const container = doc['Container'];
  if (typeof container !== 'object' || container === null) {
    throw new TemplateError('template has no <Container> root element');
  }
  const c = container as Record<string, unknown>;

  const name = text(c['Name']);
  if (!name) throw new TemplateError('template is missing <Name>');

  const repository = text(c['Repository']);
  if (!repository) throw new TemplateError('template is missing <Repository>');

  const result: ParsedTemplate = {
    name,
    repository,
    network: text(c['Network']) || 'bridge',
    privileged: text(c['Privileged']).toLowerCase() === 'true',
    icon: optional(text(c['Icon'])),
    webUi: optional(text(c['WebUI'])),
    myIp: optional(text(c['MyIP'])),
    extraParams: optional(text(c['ExtraParams'])),
    postArgs: optional(text(c['PostArgs'])),
    cpuset: optional(text(c['CPUset'])),
    volumes: [],
    ports: [],
    variables: [],
    devices: [],
    labels: [],
  };

  const rawConfigs = c['Config'];
  const configs: unknown[] =
    rawConfigs === undefined ? [] : Array.isArray(rawConfigs) ? rawConfigs : [rawConfigs];

  for (const raw of configs) {
    if (typeof raw !== 'object' || raw === null) continue;
    const node = raw as Record<string, unknown>;

    const value = text(node);
    if (!value) continue;

    const type = attr(node, 'Type');
    const target = attr(node, 'Target');
    const mode = attr(node, 'Mode');

    switch (type) {
      case 'Path':
        if (target) {
          result.volumes.push({
            hostPath: value,
            containerPath: target,
            mode: mode || 'rw',
          });
        }
        break;
      case 'Port':
        if (target) {
          result.ports.push({
            hostPort: value,
            containerPort: target,
            protocol: mode || 'tcp',
          });
        }
        break;
      case 'Variable':
        if (target) result.variables.push({ name: target, value });
        break;
      case 'Device':
        result.devices.push({ hostPath: value });
        break;
      case 'Label':
        if (target) result.labels.push({ name: target, value });
        break;
      default:
        break;
    }
  }

  return result;
}
