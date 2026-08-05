import type { RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { buildProvisionalTextEditingLayout } from './provisionalTextEditingLayout';

const layout = {
  schemaVersion: 2, key: 'exact', glyphRuns: [], lines: [], selectionGeometry: [], clusterMap: [], warnings: [],
  inkBounds: { x: 0, y: 0, width: 30, height: 12 },
  logicalBounds: { x: 0, y: 0, width: 30, height: 12 },
  caretStops: [
    { textOffset: 0, x: 0, y: 0, height: 12, affinity: 'downstream' },
    { textOffset: 1, x: 10, y: 0, height: 12, affinity: 'downstream' },
    { textOffset: 2, x: 20, y: 0, height: 12, affinity: 'downstream' },
    { textOffset: 3, x: 30, y: 0, height: 12, affinity: 'downstream' }
  ]
} satisfies RealizedTextLayout;

describe('provisional text editing layout', () => {
  it('moves an appended caret immediately without mutating the exact layout', () => {
    const provisional = buildProvisionalTextEditingLayout(layout, 'abc', 'abcde', [5]);
    expect(provisional).not.toBe(layout);
    expect(provisional.caretStops.at(-1)).toMatchObject({ textOffset: 5, x: 50 });
    expect(layout.caretStops).toHaveLength(4);
  });

  it('projects insertion and deletion around a stable suffix', () => {
    const inserted = buildProvisionalTextEditingLayout(layout, 'abc', 'aXXbc', [3]);
    expect(inserted.caretStops.at(-1)).toMatchObject({ textOffset: 3, x: 30 });
    const deleted = buildProvisionalTextEditingLayout(layout, 'abc', 'ac', [1]);
    expect(deleted.caretStops.at(-1)).toMatchObject({ textOffset: 1, x: 10 });
  });

  it('returns exact geometry when no provisional projection is needed', () => {
    expect(buildProvisionalTextEditingLayout(layout, 'abc', 'abc', [3])).toBe(layout);
    expect(buildProvisionalTextEditingLayout({ ...layout, caretStops: [] }, 'abc', 'abcd', [4]))
      .toMatchObject({ caretStops: [] });
  });
});
