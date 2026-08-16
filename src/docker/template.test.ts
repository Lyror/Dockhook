import { describe, expect, it } from 'vitest';
import { parseTemplate, TemplateError } from './template.js';

const full = `<?xml version="1.0"?>
<Container version="2">
  <Name>myapp</Name>
  <Repository>nexus.example.com/myapp:latest</Repository>
  <Network>bridge</Network>
  <Privileged>false</Privileged>
  <Icon>https://example.com/icon.png</Icon>
  <WebUI>http://[IP]:[PORT:8080]/</WebUI>
  <ExtraParams>--restart unless-stopped</ExtraParams>
  <PostArgs>--verbose</PostArgs>
  <CPUset>0,1</CPUset>
  <Config Name="appdata" Target="/app/data" Mode="rw" Type="Path">/mnt/user/appdata/myapp</Config>
  <Config Name="web" Target="8080" Mode="tcp" Type="Port">18080</Config>
  <Config Name="TZ" Target="TZ" Type="Variable">Europe/Berlin</Config>
  <Config Name="dri" Target="/dev/dri" Type="Device">/dev/dri</Config>
  <Config Name="tier" Target="app.tier" Type="Label">backend</Config>
</Container>`;

describe('parseTemplate', () => {
  it('extracts the top-level container fields', () => {
    const t = parseTemplate(full);
    expect(t.name).toBe('myapp');
    expect(t.repository).toBe('nexus.example.com/myapp:latest');
    expect(t.network).toBe('bridge');
    expect(t.privileged).toBe(false);
    expect(t.icon).toBe('https://example.com/icon.png');
    expect(t.webUi).toBe('http://[IP]:[PORT:8080]/');
    expect(t.extraParams).toBe('--restart unless-stopped');
    expect(t.postArgs).toBe('--verbose');
    expect(t.cpuset).toBe('0,1');
  });

  it('extracts the fixed ip of a container on a custom network', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2">
  <Name>x</Name><Repository>r</Repository>
  <Network>br0</Network><MyIP>192.168.1.50</MyIP>
</Container>`;
    const t = parseTemplate(xml);
    expect(t.network).toBe('br0');
    expect(t.myIp).toBe('192.168.1.50');
  });

  it('leaves myIp undefined when the template has none', () => {
    expect(parseTemplate(full).myIp).toBeUndefined();
  });

  it('extracts a path config as a volume', () => {
    expect(parseTemplate(full).volumes).toEqual([
      { hostPath: '/mnt/user/appdata/myapp', containerPath: '/app/data', mode: 'rw' },
    ]);
  });

  it('extracts a port config', () => {
    expect(parseTemplate(full).ports).toEqual([
      { hostPort: '18080', containerPort: '8080', protocol: 'tcp' },
    ]);
  });

  it('extracts variable, device and label configs', () => {
    const t = parseTemplate(full);
    expect(t.variables).toEqual([{ name: 'TZ', value: 'Europe/Berlin' }]);
    expect(t.devices).toEqual([{ hostPath: '/dev/dri' }]);
    expect(t.labels).toEqual([{ name: 'app.tier', value: 'backend' }]);
  });

  it('treats privileged true as true', () => {
    const xml = full.replace('<Privileged>false</Privileged>', '<Privileged>true</Privileged>');
    expect(parseTemplate(xml).privileged).toBe(true);
  });

  it('skips config entries with an empty value', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2">
  <Name>x</Name><Repository>r</Repository><Network>bridge</Network>
  <Config Name="web" Target="8080" Mode="tcp" Type="Port"></Config>
  <Config Name="TZ" Target="TZ" Type="Variable"></Config>
</Container>`;
    const t = parseTemplate(xml);
    expect(t.ports).toEqual([]);
    expect(t.variables).toEqual([]);
  });

  it('handles a template with a single config element', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2">
  <Name>x</Name><Repository>r</Repository><Network>host</Network>
  <Config Name="TZ" Target="TZ" Type="Variable">UTC</Config>
</Container>`;
    expect(parseTemplate(xml).variables).toEqual([{ name: 'TZ', value: 'UTC' }]);
  });

  it('handles a template with no config elements', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2">
  <Name>x</Name><Repository>r</Repository><Network>bridge</Network>
</Container>`;
    const t = parseTemplate(xml);
    expect(t.volumes).toEqual([]);
    expect(t.ports).toEqual([]);
  });

  it('defaults network to bridge when absent', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2"><Name>x</Name><Repository>r</Repository></Container>`;
    expect(parseTemplate(xml).network).toBe('bridge');
  });

  it('throws when Name is missing', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2"><Repository>r</Repository></Container>`;
    expect(() => parseTemplate(xml)).toThrow(TemplateError);
  });

  it('throws when Repository is missing', () => {
    const xml = `<?xml version="1.0"?>
<Container version="2"><Name>x</Name></Container>`;
    expect(() => parseTemplate(xml)).toThrow(TemplateError);
  });

  it('throws on malformed xml', () => {
    expect(() => parseTemplate('not xml at all <<<')).toThrow(TemplateError);
  });
});
