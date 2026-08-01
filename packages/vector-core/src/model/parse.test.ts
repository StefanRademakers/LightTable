import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from './factories';
import { parseVectorPath } from './parse';

describe('parseVectorPath', () => {
  it('returns a detached canonical path for valid serialized input', () => {
    const source = createVectorPath('path-a', 'Logo', [
      createSubpath('subpath-a', [
        createAnchor('anchor-a', { x: 12, y: 20 }),
        createAnchor('anchor-b', { x: 40, y: 20 })
      ], true)
    ]);
    source.style.stroke = {
      paint: { type: 'solid', color: [0.1, 0.2, 0.3, 1] },
      width: 4,
      cap: 'round',
      join: 'miter',
      miterLimit: 4,
      dash: [8, 2],
      dashOffset: 1
    };

    const parsed = parseVectorPath(JSON.parse(JSON.stringify(source)));

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
  });

  it('rejects malformed values and duplicate ids at the boundary', () => {
    expect(() => parseVectorPath({ type: 'path' })).toThrow('must be a vector path');
    const duplicate = createVectorPath('same', 'Duplicate', [
      createSubpath('same', [createAnchor('anchor', { x: 0, y: 0 })])
    ]);
    expect(() => parseVectorPath(duplicate)).toThrow('Duplicate vector id same');
  });

  it('rejects non-finite coordinates and invalid paint ranges', () => {
    const invalidPoint = createVectorPath('path', 'Invalid', [
      createSubpath('subpath', [createAnchor('anchor', { x: Number.NaN, y: 0 })])
    ]);
    expect(() => parseVectorPath(invalidPoint)).toThrow('must be a finite number');

    const invalidOpacity = createVectorPath('path', 'Invalid');
    invalidOpacity.style.opacity = 2;
    expect(() => parseVectorPath(invalidOpacity)).toThrow('must be between 0 and 1');
  });
});
