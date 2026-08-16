// Mirrors PHP's parse_ini_file() closely enough for the .cfg files the settings
// page writes: double-quoted values with \" escapes, # and ; comments.

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) return null;

  const separator = trimmed.indexOf('=');
  if (separator === -1) return null;

  const key = trimmed.slice(0, separator).trim();
  if (key === '') return null;

  return [key, stripQuotes(trimmed.slice(separator + 1))];
}

export function parseIni(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const pair = parseLine(line);
    if (pair) result[pair[0]] = pair[1];
  }
  return result;
}

export function parseIniSections(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      current = {};
      result[section] = current;
      continue;
    }

    // Keys outside any section are dropped, matching parse_ini_file(..., true).
    if (!current) continue;

    const pair = parseLine(trimmed);
    if (pair) current[pair[0]] = pair[1];
  }

  return result;
}
