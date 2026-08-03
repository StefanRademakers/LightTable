import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_FIXTURE_FONT_ASSET, type RealizedGlyphRun, type RealizedTextLayout } from '@lighttable/text-core';
import { prepareTextOutlineVectorDraws } from './prepareTextOutlineVectorDraws';

const glyphOutline = {
  unitsPerEm: 1_000,
  verbs: new Uint8Array([0, 1, 1, 4]),
  coordinates: new Float32Array([0, 0, 500, 1_000, 1_000, 0]),
  bounds: new Float32Array([0, 0, 1_000, 1_000])
};

const run = (overrides: Partial<RealizedGlyphRun> = {}): RealizedGlyphRun => ({
  font: {
    font: CONTRACT_FIXTURE_FONT_ASSET,
    variableAxes: {}, syntheticBold: false, syntheticItalic: false
  },
  fontSize: 100,
  fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
  paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0.5, g: 0, b: 0, a: 0.75 } } },
  renderingMode: 'fill', direction: 'ltr',
  glyphIds: new Uint32Array([42, 42]), clusters: new Uint32Array([0, 1]),
  geometry: new Float32Array([10, 20, 50, 0, 70, 20, 50, 0]),
  ...overrides
});

const layout = (glyphRun: RealizedGlyphRun): RealizedTextLayout => ({
  schemaVersion: 2, key: 'layout', glyphRuns: [glyphRun], lines: [], caretStops: [],
  selectionGeometry: [], clusterMap: [],
  inkBounds: { x: 10, y: -80, width: 160, height: 100 },
  logicalBounds: { x: 10, y: -80, width: 160, height: 100 }, warnings: []
});

const identity = {
  documentSessionId: 'document', sessionGeneration: 3,
  fontSnapshotRevision: 4, sourceScale: 2
};

describe('prepareTextOutlineVectorDraws', () => {
  it('resolves repeated outlines once and reuses one scale-independent GPU geometry key', async () => {
    const resolve = vi.fn().mockResolvedValue({ outline: glyphOutline, source: 'worker' });
    const prepared = await prepareTextOutlineVectorDraws({ resolve }, layout(run()), identity);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(prepared.uniqueOutlineCount).toBe(1);
    expect(prepared.draws).toHaveLength(2);
    expect(prepared.draws[0]?.geometry.key).toEqual(prepared.draws[1]?.geometry.key);
    expect(prepared.draws[0]?.path.transform).toEqual({
      a: 0.2, b: 0, c: 0, d: -0.2, tx: 20, ty: 40
    });
    expect(prepared.draws[1]?.path.transform.tx).toBe(140);
    expect(prepared.draws[0]?.path.style.fill?.color[0]).toBeCloseTo(0.214041, 5);
  });

  it('maps native text stroke width into scale-independent font units', async () => {
    const stroked = run({
      renderingMode: 'fill-stroke',
      paint: {
        fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } },
        stroke: {
          paint: { kind: 'solid', color: { colorSpace: 'display-p3', r: 1, g: 0, b: 0, a: 1 } },
          width: 2, cap: 'round', join: 'bevel', miterLimit: 4
        }
      }
    });
    const prepared = await prepareTextOutlineVectorDraws({
      resolve: vi.fn().mockResolvedValue({ outline: glyphOutline, source: 'worker' })
    }, layout(stroked), identity);

    expect(prepared.draws[0]?.path.style.stroke).toMatchObject({
      width: 20, cap: 'round', join: 'bevel'
    });
    expect(prepared.draws[0]?.path.style.stroke?.paint.color[0]).toBeGreaterThan(1);
  });

  it('composes affine per-glyph transforms before document source scaling', async () => {
    const transformed = run({
      glyphIds: new Uint32Array([42]), clusters: new Uint32Array([0]),
      geometry: new Float32Array([10, 20, 50, 0]),
      transforms: new Float32Array([2, 0, 3, 0, 0.5, 4, 0, 0, 1])
    });
    const prepared = await prepareTextOutlineVectorDraws({
      resolve: vi.fn().mockResolvedValue({ outline: glyphOutline, source: 'worker' })
    }, layout(transformed), identity);

    expect(prepared.draws[0]?.path.transform).toEqual({
      a: 0.4, b: 0, c: 0, d: -0.1, tx: 26, ty: 48
    });
  });

  it('rejects unsupported gradient and clipping semantics explicitly', async () => {
    const repository = {
      resolve: vi.fn().mockResolvedValue({ outline: glyphOutline, source: 'worker' })
    };
    await expect(prepareTextOutlineVectorDraws(repository, layout(run({
      paint: { fill: {
        kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: []
      } }
    })), identity)).rejects.toThrow('gradient backend');
    await expect(prepareTextOutlineVectorDraws(repository, layout(run({
      renderingMode: 'fill-clip'
    })), identity)).rejects.toThrow('clip-stack');
  });

  it('rejects viewport-like invalid scale values at the document boundary', async () => {
    await expect(prepareTextOutlineVectorDraws({ resolve: vi.fn() }, layout(run()), {
      ...identity, sourceScale: 0
    })).rejects.toThrow('source scale');
  });

  it('carries paragraph clipping in source pixels and excludes fully hidden lines', async () => {
    const paragraphRun = run({
      glyphIds: new Uint32Array([42, 42, 42]), clusters: new Uint32Array([0, 1, 2]),
      geometry: new Float32Array([10, 20, 50, 0, 70, 50, 50, 0, 70, 80, 50, 0])
    });
    const clippedLayout: RealizedTextLayout = {
      ...layout(paragraphRun),
      paragraphFrame: {
        bounds: { x: 5, y: 10, width: 100, height: 40 },
        overflow: 'clip', overflowed: true, firstOverflowTextOffset: 1
      },
      lines: [
        { start: 0, end: 1, baseline: 20, ascent: 10, descent: 2, bounds: { x: 5, y: 10, width: 50, height: 12 } },
        { start: 1, end: 2, baseline: 50, ascent: 10, descent: 2, bounds: { x: 5, y: 40, width: 50, height: 12 } }
      ]
    };
    const prepared = await prepareTextOutlineVectorDraws({
      resolve: vi.fn().mockResolvedValue({ outline: glyphOutline, source: 'worker' })
    }, clippedLayout, identity);

    // The crossing line remains and is cut geometrically; later fully-hidden
    // lines never allocate outline work or GPU draws.
    expect(prepared.draws).toHaveLength(2);
    expect(prepared.draws[0]?.clip).toEqual({ x: 10, y: 20, width: 200, height: 80 });
  });
});
