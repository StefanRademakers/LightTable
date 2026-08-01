import { describe, expect, it } from 'vitest';
import { PenPathBuilder, type VectorIdSource } from './PenPathBuilder';

const ids = (): VectorIdSource => {
  let value = 0;
  return { next: (kind) => `${kind}-${++value}` };
};

describe('PenPathBuilder', () => {
  it('keeps preview ids stable and does not mutate authored anchors', () => {
    const builder = PenPathBuilder.start(ids());
    const first = builder.previewPlace({ x: 4, y: 7 });
    const second = builder.previewPlace({ x: 8, y: 9 });

    expect(builder.anchorCount()).toBe(0);
    expect(first.subpaths[0]?.anchors[0]?.id).toBe(second.subpaths[0]?.anchors[0]?.id);
    expect(second.subpaths[0]?.anchors[0]?.position).toEqual({ x: 8, y: 9 });

    const placed = builder.place({ x: 8, y: 9 });
    expect(placed.subpaths[0]?.anchors[0]?.id).toBe(second.subpaths[0]?.anchors[0]?.id);
    expect(builder.anchorCount()).toBe(1);
  });

  it('creates symmetric handles from a drag gesture', () => {
    const builder = PenPathBuilder.start(ids());
    const path = builder.place({ x: 10, y: 10 }, { dragTo: { x: 14, y: 13 } });
    const anchor = path.subpaths[0]?.anchors[0];

    expect(anchor).toMatchObject({
      handleIn: { x: 6, y: 7 },
      handleOut: { x: 14, y: 13 },
      mode: 'symmetric'
    });
  });
});
