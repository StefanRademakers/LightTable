import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createVectorPath,
  createSubpath,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix
} from '@lighttable/vector-core';
import { buildVectorEditingOverlay } from './editingOverlay';

describe('buildVectorEditingOverlay', () => {
  it('preserves cubic curves and projects every control point into document space', () => {
    const path = createVectorPath('path', 'Path', [
      createSubpath('subpath', [
        createAnchor('a', { x: 1, y: 2 }, {
          handleOut: { x: 4, y: 2 }
        }),
        createAnchor('b', { x: 5, y: 6 }, {
          handleIn: { x: 5, y: 4 }
        })
      ])
    ]);
    path.transform = multiplyMatrices(
        translationMatrix(30, 20),
        multiplyMatrices(rotationMatrix(Math.PI / 2), scaleMatrix(2, 3))
      );

    const overlay = buildVectorEditingOverlay(path, {
      selection: {
        anchors: [{ subpathId: 'subpath', anchorId: 'a' }],
        activeAnchor: { subpathId: 'subpath', anchorId: 'a' }
      }
    });

    expect(overlay.cubics).toHaveLength(1);
    expect(overlay.resourceKey).toContain('path:0:0:0:subpath/a:subpath/a');
    expect(overlay.cubics[0]).toMatchObject({
      p0: { x: 24, y: 22 },
      p1: { x: 24, y: 28 },
      p2: { x: 18, y: 30 },
      p3: { x: 12, y: 30 }
    });
    expect(overlay.anchors[0]).toMatchObject({
      point: { x: 24, y: 22 },
      selected: true,
      active: true,
      markerSizePx: 7
    });
    expect(overlay.handles).toEqual([expect.objectContaining({
      kind: 'out',
      anchor: { x: 24, y: 22 },
      point: { x: 24, y: 28 },
      markerSizePx: 6
    })]);
  });

  it('does not expose handles for unselected anchors', () => {
    const path = createVectorPath('path', 'Path', [createSubpath('subpath', [
      createAnchor('a', { x: 0, y: 0 }, { handleOut: { x: 10, y: 0 } }),
      createAnchor('b', { x: 20, y: 0 }, { handleIn: { x: 10, y: 0 } })
    ])]);
    const overlay = buildVectorEditingOverlay(path);
    expect(overlay.anchors).toHaveLength(2);
    expect(overlay.handles).toEqual([]);
  });

  it('rejects non-positive screen marker sizes', () => {
    expect(() => buildVectorEditingOverlay(createVectorPath('path'), { anchorSizePx: 0 }))
      .toThrow(/anchor size/i);
  });
});
