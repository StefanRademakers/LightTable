import { describe, expect, it } from 'vitest';
import { createColorLookupDeviceLinkProfile } from './colorLookupIccProfile';

const identity = new TextEncoder().encode([
  'TITLE "Identity"', 'LUT_3D_SIZE 2',
  '0 0 0', '1 0 0', '0 1 0', '1 1 0',
  '0 0 1', '1 0 1', '0 1 1', '1 1 1'
].join('\n'));

describe('createColorLookupDeviceLinkProfile', () => {
  it('emits a Photoshop-compatible ICC v4 RGB DeviceLink with a 17-cube D2B0 CLUT', () => {
    const profile = createColorLookupDeviceLinkProfile(identity);
    const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
    expect(view.getUint32(0, false)).toBe(profile.length);
    expect(new TextDecoder().decode(profile.slice(12, 24))).toBe('linkRGB RGB ');
    expect(new TextDecoder().decode(profile.slice(36, 40))).toBe('acsp');
    expect(new TextDecoder().decode(profile).includes('D2B0')).toBe(true);
    const tags = view.getUint32(128, false);
    let d2b0 = -1;
    for (let index = 0; index < tags; index += 1) {
      const entry = 132 + index * 12;
      if (new TextDecoder().decode(profile.slice(entry, entry + 4)) === 'D2B0') {
        d2b0 = view.getUint32(entry + 4, false);
      }
    }
    expect(d2b0).toBeGreaterThan(0);
    const clut = d2b0 + 24;
    expect(new TextDecoder().decode(profile.slice(clut, clut + 4))).toBe('clut');
    expect(profile[clut + 12]).toBe(17);
    expect(profile[clut + 13]).toBe(17);
    expect(profile[clut + 14]).toBe(17);
  });
});
