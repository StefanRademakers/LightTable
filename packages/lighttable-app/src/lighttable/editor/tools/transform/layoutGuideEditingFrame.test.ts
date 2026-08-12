import { describe, expect, it } from 'vitest';
import { buildDocumentGridFrame, buildDocumentGuideFrame } from './layoutGuideEditingFrame';

describe('layout guide GPU frames', () => {
  it('projects vertical and horizontal guides without handles', () => {
    const result = buildDocumentGuideFrame([
      { id: 'v', orientation: 'vertical', position: 20 },
      { id: 'h', orientation: 'horizontal', position: 30 }
    ], 100, 80)!;
    expect(result.edges).toEqual([
      { start: { x: 20, y: 0 }, end: { x: 20, y: 80 } },
      { start: { x: 0, y: 30 }, end: { x: 100, y: 30 } }
    ]);
    expect(result.handles).toEqual([]);
  });

  it('coarsens only dense grid presentation at low zoom', () => {
    const normal = buildDocumentGridFrame(100, 100, 10, 0, 0, 1)!;
    const zoomedOut = buildDocumentGridFrame(100, 100, 10, 0, 0, 0.1)!;
    expect(normal.edges.length).toBe(22);
    expect(zoomedOut.edges.length).toBeLessThan(normal.edges.length);
  });
});
