import { describe, expect, it } from 'vitest';
import { parseIni, parseIniSections } from './ini.js';

describe('parseIni', () => {
  it('reads quoted key value pairs', () => {
    expect(parseIni('TOKEN="secret"\nPORT="8377"\n')).toEqual({
      TOKEN: 'secret',
      PORT: '8377',
    });
  });

  it('reads unquoted values', () => {
    expect(parseIni('PORT=8377\n')).toEqual({ PORT: '8377' });
  });

  it('trims whitespace around keys and values', () => {
    expect(parseIni('  PORT  =  "8377"  \n')).toEqual({ PORT: '8377' });
  });

  it('ignores comments and blank lines', () => {
    const text = '# a comment\n\n; another comment\nPORT="8377"\n';
    expect(parseIni(text)).toEqual({ PORT: '8377' });
  });

  it('unescapes an escaped double quote', () => {
    expect(parseIni('MSG="say \\"hi\\""\n')).toEqual({ MSG: 'say "hi"' });
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseIni('TOKEN="a=b=c"\n')).toEqual({ TOKEN: 'a=b=c' });
  });

  it('returns an empty object for empty input', () => {
    expect(parseIni('')).toEqual({});
  });

  it('ignores lines without an equals sign', () => {
    expect(parseIni('garbage\nPORT="1"\n')).toEqual({ PORT: '1' });
  });

  it('handles crlf line endings', () => {
    expect(parseIni('PORT="8377"\r\nTOKEN="x"\r\n')).toEqual({
      PORT: '8377',
      TOKEN: 'x',
    });
  });
});

describe('parseIniSections', () => {
  it('groups keys under their section', () => {
    const text = `[myapp]
KIND="container"
NAME="MyApp"

[backup]
KIND="script"
ID="nightly-backup"
`;
    expect(parseIniSections(text)).toEqual({
      myapp: { KIND: 'container', NAME: 'MyApp' },
      backup: { KIND: 'script', ID: 'nightly-backup' },
    });
  });

  it('ignores keys before the first section', () => {
    expect(parseIniSections('STRAY="1"\n[a]\nKIND="script"\n')).toEqual({
      a: { KIND: 'script' },
    });
  });

  it('returns an empty object for empty input', () => {
    expect(parseIniSections('')).toEqual({});
  });

  it('trims whitespace around the section name', () => {
    expect(parseIniSections('[  myapp  ]\nKIND="script"\n')).toEqual({
      myapp: { KIND: 'script' },
    });
  });

  it('ignores comments inside a section', () => {
    expect(parseIniSections('[a]\n# note\nKIND="script"\n')).toEqual({
      a: { KIND: 'script' },
    });
  });
});
