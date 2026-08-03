import type { RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
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
});
