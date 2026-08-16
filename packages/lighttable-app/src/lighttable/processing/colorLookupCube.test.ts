import { describe, expect, it } from 'vitest';
import { cubeRgbaValues, parseCubeLut } from './colorLookupCube';

describe('parseCubeLut', () => {
  it('parses a BOM, comments, title, domain and red-fastest 3D values', () => {
    const parsed = parseCubeLut(`\uFEFF# identity\nTITLE "Tiny LUT"\nLUT_3D_SIZE 2\nDOMAIN_MIN -1 0 0\nDOMAIN_MAX 1 2 3\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`);
    expect(parsed).toMatchObject({
      title: 'Tiny LUT', size: 2,
      domainMin: [-1, 0, 0], domainMax: [1, 2, 3]
    });
    expect([...parsed.values.slice(0, 6)]).toEqual([0, 0, 0, 1, 0, 0]);
    expect([...cubeRgbaValues(parsed).slice(-4)]).toEqual([1, 1, 1, 1]);
  });

  it('accepts the common scalar LUT_3D_INPUT_RANGE form', () => {
    const rows = Array.from({ length: 8 }, () => '0 0 0').join('\n');
    expect(parseCubeLut(`LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE -0.5 1.5\n${rows}`))
      .toMatchObject({ domainMin: [-0.5, -0.5, -0.5], domainMax: [1.5, 1.5, 1.5] });
  });

  it('rejects incomplete and 1D LUTs instead of producing corrupted color', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0')).toThrow(/8 are required/);
    expect(() => parseCubeLut('LUT_1D_SIZE 16')).toThrow(/not 1D/);
  });
});
