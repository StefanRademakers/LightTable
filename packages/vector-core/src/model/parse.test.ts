import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorLiveShape, createVectorPath } from './factories';
import { parseVectorElement, parseVectorLiveShape, parseVectorPath } from './parse';

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
      alignment: 'center',
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

describe('parseVectorLiveShape', () => {
  it('strictly round-trips supported live geometry', () => {
    const shape = createVectorLiveShape('roundtrip', {
      kind: 'rectangle', width: 120, height: 80,
      cornerRadii: [2, 4, 6, 8], linkedCorners: false
    });
    expect(parseVectorLiveShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape);
    expect(parseVectorElement(shape)).toEqual(shape);
  });

  it('rejects invalid or unsupported geometry at the persistence boundary', () => {
    const shape = createVectorLiveShape('invalid', { kind: 'ellipse', width: 10, height: 10 });
    expect(() => parseVectorLiveShape({
      ...shape,
      geometry: { kind: 'ellipse', width: -1, height: 10 }
    })).toThrow('geometry.width must not be negative');
    expect(() => parseVectorElement({ ...shape, type: 'future-shape' })).toThrow('type is not supported');
  });

  it.each([
    { kind: 'triangle', width: 90, height: 60, cornerRadius: 4 },
    { kind: 'polygon', sides: 7, radius: 40, rotationRadians: 0.25, cornerRadius: 3 },
    { kind: 'star', points: 5, outerRadius: 50, innerRadius: 22, rotationRadians: -0.5, cornerRadius: 2 },
    {
      kind: 'line',
      start: { x: -10, y: 2 },
      end: { x: 120, y: 32 },
      startArrow: null,
      endArrow: { width: 18, length: 24, concavity: 0.25 }
    }
  ] as const)('round-trips $kind geometry without converting it to a path', (geometry) => {
    const shape = createVectorLiveShape(`shape-${geometry.kind}`, geometry);
    expect(parseVectorLiveShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape);
  });

  it('rejects unbounded point counts and invalid arrowheads', () => {
    const polygon = createVectorLiveShape('polygon', {
      kind: 'polygon', sides: 5, radius: 20, rotationRadians: 0, cornerRadius: 0
    });
    expect(() => parseVectorLiveShape({
      ...polygon,
      geometry: { ...polygon.geometry, sides: 4097 }
    })).toThrow('geometry.sides must be between three and 4096');

    const line = createVectorLiveShape('line', {
      kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
      startArrow: null, endArrow: { width: 5, length: 8, concavity: 0 }
    });
    expect(() => parseVectorLiveShape({
      ...line,
      geometry: {
        ...line.geometry,
        endArrow: { width: 5, length: 8, concavity: 2 }
      }
    })).toThrow('concavity');
  });
});
