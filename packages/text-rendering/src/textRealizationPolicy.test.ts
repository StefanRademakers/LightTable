import { describe, expect, it } from 'vitest';
import type { RealizedGlyphRun, RealizedTextLayout } from '@lighttable/text-core';
import { selectTextRealizationRoute } from './textRealizationPolicy';

const run = (overrides: Partial<RealizedGlyphRun> = {}): RealizedGlyphRun => ({
  font: {
    font: {
      assetId: 'inter', faceIndex: 0, fingerprintSha256: 'a'.repeat(64), source: 'bundled',
      container: 'woff2', outline: 'truetype',
      embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
    },
    variableAxes: {}, syntheticBold: false, syntheticItalic: false
  },
  fontSize: 16,
  fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
  paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
  renderingMode: 'fill', direction: 'ltr',
  glyphIds: new Uint32Array([1]), clusters: new Uint32Array([0]),
  geometry: new Float32Array([0, 16, 10, 0]),
  ...overrides
});

const layout = (...runs: RealizedGlyphRun[]): RealizedTextLayout => ({
  schemaVersion: 2, key: 'layout', glyphRuns: runs, lines: [], caretStops: [],
  selectionGeometry: [], clusterMap: [],
  inkBounds: { x: 0, y: 0, width: 20, height: 20 },
  logicalBounds: { x: 0, y: 0, width: 20, height: 20 }, warnings: []
});

describe('selectTextRealizationRoute', () => {
  it('keeps ordinary document-sized editing on the fast coverage atlas', () => {
    expect(selectTextRealizationRoute(layout(run()), {
      documentScale: 2, purpose: 'interactive'
    })).toEqual({ route: 'coverage-atlas', reason: 'fast-interactive-coverage', targetPpem: 32 });
  });

  it('uses outlines above the finite coverage ppem range', () => {
    expect(selectTextRealizationRoute(layout(run({ fontSize: 100 })), {
      documentScale: 3, purpose: 'interactive'
    })).toEqual({ route: 'outline-vector', reason: 'coverage-scale-limit', targetPpem: 300 });
  });

  it.each([
    ['stroke', { paint: { stroke: {
      paint: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } },
      width: 1, cap: 'butt', join: 'miter', miterLimit: 4
    } } }],
    ['glyph-transform', { transforms: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) }],
    ['variable-font', { font: { ...run().font, variableAxes: { wght: 650 } } }],
    ['vertical-writing', { direction: 'ttb' }]
  ] as const)('selects outlines for %s content', (reason, overrides) => {
    expect(selectTextRealizationRoute(layout(run(overrides as Partial<RealizedGlyphRun>)), {
      documentScale: 1, purpose: 'interactive'
    }).reason).toBe(reason);
  });

  it('always selects scale-independent outlines for final output', () => {
    expect(selectTextRealizationRoute(layout(run()), {
      documentScale: 1, outputScale: 4, purpose: 'final-output'
    })).toEqual({ route: 'outline-vector', reason: 'output-quality', targetPpem: 64 });
  });

  it('has no viewport-zoom input and remains stable while presentation zoom changes elsewhere', () => {
    const request = { documentScale: 1, purpose: 'interactive' as const };
    const beforeZoom = selectTextRealizationRoute(layout(run()), request);
    const unrelatedViewport = { zoom: 32 };
    expect(unrelatedViewport.zoom).toBe(32);
    expect(selectTextRealizationRoute(layout(run()), request)).toEqual(beforeZoom);
  });

  it('rejects invalid document/output scales', () => {
    expect(() => selectTextRealizationRoute(layout(run()), {
      documentScale: 0, purpose: 'interactive'
    })).toThrow('document scale');
    expect(() => selectTextRealizationRoute(layout(run()), {
      documentScale: 1, outputScale: Number.NaN, purpose: 'final-output'
    })).toThrow('output scale');
  });
});
