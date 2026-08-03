import {
  TEXT_LAYOUT_SCHEMA_VERSION,
  createDefaultFlowTextSource,
  type RealizedTextLayout
} from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { TextLayoutCache, estimateTextLayoutBytes } from './TextLayoutCache';

const layout = (key: string, glyphs: number): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key,
  glyphRuns: [{
    font: {} as never,
    fontSize: 16,
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: createDefaultFlowTextSource('x').styleRuns[0].requestedFont },
    paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
    renderingMode: 'fill',
    direction: 'ltr',
    glyphIds: new Uint32Array(glyphs),
    clusters: new Uint32Array(glyphs),
    geometry: new Float32Array(glyphs * 4)
  }],
  lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
  inkBounds: { x: 0, y: 0, width: 1, height: 1 },
  logicalBounds: { x: 0, y: 0, width: 1, height: 1 },
  warnings: []
});

describe('text layout cache', () => {
  it('evicts the least recently used immutable layout by estimated bytes', () => {
    const first = layout('first', 4);
    const second = layout('second', 4);
    const third = layout('third', 4);
    const bytes = Math.max(...[first, second, third].map(estimateTextLayoutBytes));
    const cache = new TextLayoutCache(bytes * 2);
    cache.set('first', first);
    cache.set('second', second);
    expect(cache.get('first')).toBe(first);
    cache.set('third', third);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(first);
    expect(cache.metrics()).toMatchObject({ entries: 2, evictions: 1 });
  });

  it('does not retain one layout larger than the complete budget', () => {
    const cache = new TextLayoutCache(128);
    const oversized = layout('oversized', 100);
    expect(cache.set('oversized', oversized)).toBe(oversized);
    expect(cache.get('oversized')).toBeUndefined();
    expect(cache.metrics()).toMatchObject({ entries: 0, byteLength: 0, budgetBytes: 128 });
  });

  it('clears owned bytes while retaining lifetime telemetry counters', () => {
    const value = layout('value', 1);
    const cache = new TextLayoutCache(4096);
    cache.set('value', value);
    expect(cache.get('value')).toBe(value);
    cache.clear();
    expect(cache.metrics()).toMatchObject({ entries: 0, byteLength: 0, hits: 1 });
  });
});
