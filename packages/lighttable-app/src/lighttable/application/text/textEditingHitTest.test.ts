import type { PathTextLayout, RealizedTextLayout } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { realizePathArcLength } from '@lighttable/vector-rendering';
import { describe, expect, it } from 'vitest';
import { projectRigidGlyphRunsToPath } from '../../text/rendering/rigidPathGlyphProjection';
import { hitTestTextEditingLayout } from './textEditingHitTest';

const layout = {
  schemaVersion: 2, key: 'layout', glyphRuns: [], lines: [], selectionGeometry: [], clusterMap: [], warnings: [],
  inkBounds: { x: 0, y: 0, width: 20, height: 10 },
  logicalBounds: { x: 0, y: 0, width: 20, height: 10 },
  caretStops: [
    { textOffset: 0, x: 0, y: 10, height: 10, affinity: 'downstream' },
    { textOffset: 1, x: 10, y: 10, height: 10, affinity: 'upstream' },
    { textOffset: 1, x: 18, y: 10, height: 10, affinity: 'downstream' }
  ]
} satisfies RealizedTextLayout;

const pathLayout = (change: Partial<PathTextLayout> = {}): PathTextLayout => ({
  mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
  startOffset: 10, endOffset: 90, side: 'left', upright: false, ...change
});

const pathMetric = (vertical = false) => realizePathArcLength(createVectorPath('path', 'Line', [
  createSubpath('line', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', vertical ? { x: 0, y: 100 } : { x: 100, y: 0 })
  ])
]), 'line', identityAffineMatrix(), 0.25);

const pathTarget = (
  realizedLayout: RealizedTextLayout,
  authoredPathLayout: PathTextLayout,
  table = pathMetric()
) => ({
  layout: realizedLayout,
  localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 7 },
  path: {
    pathLayout: authoredPathLayout,
    table,
    projection: projectRigidGlyphRunsToPath(realizedLayout, authoredPathLayout, table, 'start')
  }
});

describe('text editing hit test', () => {
  it('inverts nested scene transforms before choosing the physical caret', () => {
    const target = {
      layout,
      localToDocument: { a: 0, b: 2, c: -2, d: 0, tx: 100, ty: 50 }
    };
    expect(hitTestTextEditingLayout(target, { x: 80, y: 86 })).toMatchObject({
      offset: 1, affinity: 'downstream'
    });
  });

  it('rejects points outside logical text bounds and singular transforms', () => {
    expect(hitTestTextEditingLayout({
      layout, localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    }, { x: 100, y: 100 })).toBeNull();
    expect(hitTestTextEditingLayout({
      layout, localToDocument: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }
    }, { x: 0, y: 0 })).toBeNull();
  });

  it('keeps an empty paragraph frame hittable before it has glyph geometry', () => {
    const paragraph = {
      ...layout,
      caretStops: [],
      logicalBounds: { x: 12, y: 18, width: 0, height: 0 },
      paragraphFrame: {
        bounds: { x: 10, y: 15, width: 140, height: 80 },
        overflow: 'indicator' as const,
        overflowed: false,
        visibleLineCount: 0
      }
    };
    expect(hitTestTextEditingLayout({
      layout: paragraph,
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 30 }
    }, { x: 100, y: 80 })).toMatchObject({ offset: 0, affinity: 'downstream' });
  });

  it('reuses its caret spatial index instead of rescanning the paragraph', () => {
    let iterationAllowed = true;
    const caretStops = new Proxy(layout.caretStops, {
      get(target, property, receiver) {
        if ((property === Symbol.iterator || property === 'forEach' || property === 'find')
          && !iterationAllowed) {
          throw new Error('caret collection rescanned');
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const indexedLayout = { ...layout, key: 'indexed', caretStops };
    const target = {
      layout: indexedLayout,
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    };
    expect(hitTestTextEditingLayout(target, { x: 1, y: 10 })?.offset).toBe(0);
    iterationAllowed = false;
    expect(hitTestTextEditingLayout(target, { x: 17, y: 10 })).toMatchObject({
      offset: 1, affinity: 'downstream'
    });
  });

  it('hits rotated path carets in path space and rejects distant points', () => {
    const target = pathTarget(layout, pathLayout(), pathMetric(true));
    expect(hitTestTextEditingLayout(target, { x: -35, y: 27 })).toMatchObject({
      offset: 0, affinity: 'downstream'
    });
    expect(hitTestTextEditingLayout(target, { x: 400, y: 400 })).toBeNull();
  });

  it('chooses logical carets in reverse path traversal order', () => {
    const authoredPathLayout = pathLayout({ direction: 'reverse' });
    const target = pathTarget(layout, authoredPathLayout);
    expect(hitTestTextEditingLayout(target, { x: 185, y: -13 })).toMatchObject({
      offset: 0, affinity: 'downstream'
    });
    expect(hitTestTextEditingLayout(target, { x: 165, y: -13 })).toMatchObject({
      offset: 1, affinity: 'upstream'
    });
  });

  it('indexes path caret traversal once for repeated pointer hit tests', () => {
    let iterationAllowed = true;
    const caretStops = new Proxy(layout.caretStops, {
      get(target, property, receiver) {
        if ((property === 'map' || property === Symbol.iterator) && !iterationAllowed) {
          throw new Error('path caret collection rescanned');
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const indexedLayout = { ...layout, key: 'path-indexed', caretStops };
    const target = pathTarget(indexedLayout, pathLayout());
    expect(hitTestTextEditingLayout(target, { x: 25, y: 27 })?.offset).toBe(0);
    iterationAllowed = false;
    expect(hitTestTextEditingLayout(target, { x: 65, y: 27 })?.offset).toBe(1);
  });
});
