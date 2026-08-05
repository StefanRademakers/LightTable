import { describe, expect, it } from 'vitest';
import { readPsdColorProfile } from './psdColorProfile';

const u16 = (value: number) => [(value >>> 8) & 255, value & 255];
const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255,
  (value >>> 8) & 255, value & 255];
const ascii = (value: string) => [...value].map((character) => character.charCodeAt(0));
const resource = (id: number, data: number[]) => [
  ...ascii('8BIM'), ...u16(id), 0, 0, ...u32(data.length), ...data,
  ...(data.length % 2 ? [0] : [])
];
const psd = (resources: number[]) => new Uint8Array([
  ...ascii('8BPS'), ...u16(1), 0, 0, 0, 0, 0, 0, ...u16(4), ...u32(1), ...u32(1),
  ...u16(8), ...u16(3), ...u32(0), ...u32(resources.length), ...resources
]).buffer;
const profile = (name: string) => {
  const bytes = new Array(144 + name.length + 1).fill(0);
  bytes.splice(128, 4, ...u32(1));
  bytes.splice(132, 12, ...ascii('desc'), ...u32(144), ...u32(name.length + 13));
  bytes.splice(144, 12, ...ascii('desc'), 0, 0, 0, 0, ...u32(name.length + 1));
  bytes.splice(156, name.length + 1, ...ascii(name), 0);
  return bytes;
};

describe('readPsdColorProfile', () => {
  it('reports an untagged document without an ICC resource', () => {
    expect(readPsdColorProfile(psd([]))).toEqual({
      disposition: 'untagged', name: null, bytes: null
    });
  });

  it('extracts the bounded ICC payload and description', () => {
    const result = readPsdColorProfile(psd(resource(1039, profile('Adobe RGB (1998)'))));
    expect(result.disposition).toBe('embedded');
    expect(result.name).toBe('Adobe RGB (1998)');
    expect(result.bytes?.byteLength).toBeGreaterThan(128);
  });

  it('honors Photoshop explicit untagged metadata', () => {
    const result = readPsdColorProfile(psd([
      ...resource(1039, profile('sRGB IEC61966-2.1')),
      ...resource(1041, [1])
    ]));
    expect(result).toEqual({ disposition: 'untagged', name: null, bytes: null });
  });
});
