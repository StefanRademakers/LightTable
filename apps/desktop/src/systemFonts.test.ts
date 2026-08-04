import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspectSystemFont } from './systemFonts';

const putTag = (bytes: Uint8Array, offset: number, tag: string) => {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = tag.charCodeAt(index);
};

const utf16 = (value: string) => {
  const bytes = new Uint8Array(value.length * 2);
  const view = new DataView(bytes.buffer);
  [...value].forEach((character, index) => view.setUint16(index * 2, character.charCodeAt(0)));
  return bytes;
};

const nameTable = (family: string, style: string) => {
  const values = [[1, family], [2, style], [6, `${family.replace(/\s/g, '')}-${style}`]] as const;
  const strings = values.map(([, value]) => utf16(value));
  const length = 6 + values.length * 12 + strings.reduce((sum, value) => sum + value.byteLength, 0);
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, values.length);
  view.setUint16(4, 6 + values.length * 12);
  let stringOffset = 0;
  values.forEach(([nameId], index) => {
    const offset = 6 + index * 12;
    view.setUint16(offset, 3);
    view.setUint16(offset + 2, 1);
    view.setUint16(offset + 4, 0x409);
    view.setUint16(offset + 6, nameId);
    view.setUint16(offset + 8, strings[index]!.byteLength);
    view.setUint16(offset + 10, stringOffset);
    bytes.set(strings[index]!, 6 + values.length * 12 + stringOffset);
    stringOffset += strings[index]!.byteLength;
  });
  return bytes;
};

const os2Table = (weight: number, width: number, fsType: number, italic: boolean) => {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, weight);
  view.setUint16(6, width);
  view.setUint16(8, fsType);
  view.setUint16(62, italic ? 1 : 0);
  return bytes;
};

const fvarTable = () => {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 16);
  view.setUint16(8, 1);
  view.setUint16(10, 20);
  putTag(bytes, 16, 'wght');
  view.setInt32(20, 100 * 65536);
  view.setInt32(24, 400 * 65536);
  view.setInt32(28, 900 * 65536);
  return bytes;
};

const face = (base: number, family: string, style: string, fsType = 0, variable = false) => {
  const entries = [
    ['name', nameTable(family, style)],
    ['OS/2', os2Table(/bold/i.test(style) ? 700 : 400, 5, fsType, /italic/i.test(style))],
    ['glyf', new Uint8Array(4)],
    ...(variable ? [['fvar', fvarTable()] as const] : [])
  ] as const;
  const headerLength = 12 + entries.length * 16;
  const size = headerLength + entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, entries.length);
  let payload = headerLength;
  entries.forEach(([tag, table], index) => {
    const record = 12 + index * 16;
    putTag(bytes, record, tag);
    view.setUint32(record + 8, base + payload);
    view.setUint32(record + 12, table.byteLength);
    bytes.set(table, payload);
    payload += table.byteLength;
  });
  return bytes;
};

describe('Windows system font inspection', () => {
  it('reads TTC faces, variable axes and OS/2 embedding rights', () => {
    const firstOffset = 20;
    const first = face(firstOffset, 'Fixture Variable', 'Regular', 0x108, true);
    const secondOffset = firstOffset + first.byteLength;
    const second = face(secondOffset, 'Fixture Collection', 'Bold Italic', 0x2);
    const bytes = new Uint8Array(secondOffset + second.byteLength);
    putTag(bytes, 0, 'ttcf');
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 0x00010000);
    view.setUint32(8, 2);
    view.setUint32(12, firstOffset);
    view.setUint32(16, secondOffset);
    bytes.set(first, firstOffset);
    bytes.set(second, secondOffset);
    const fingerprint = createHash('sha256').update(bytes).digest('hex');

    const assets = inspectSystemFont(bytes, fingerprint);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      faceIndex: 0,
      familyNames: ['Fixture Variable'],
      embedding: { level: 'editable', noSubsetting: true, bitmapOnly: false },
      variableAxes: [{ tag: 'wght', minimum: 100, defaultValue: 400, maximum: 900 }]
    });
    expect(assets[1]).toMatchObject({
      faceIndex: 1,
      familyNames: ['Fixture Collection'],
      weight: 700,
      italic: true,
      embedding: { level: 'restricted' }
    });
  });
});
