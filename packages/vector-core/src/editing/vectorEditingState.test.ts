import { describe, expect, it } from 'vitest';
import { PenPathBuilder, type VectorIdSource } from './PenPathBuilder';
import { emptyVectorSelection, selectAnchor, selectHitTarget, toggleAnchorSelection } from './vectorSelectionState';

class SequentialIds implements VectorIdSource {
  private value = 0;
  next(kind: 'path' | 'subpath' | 'anchor') {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

describe('PenPathBuilder', () => {
  it('constructs open and closed paths without host state', () => {
    const builder = PenPathBuilder.start(new SequentialIds(), 'Logo');
    builder.place({ x: 10, y: 20 });
    builder.place({ x: 30, y: 20 }, { dragTo: { x: 35, y: 25 } });
    const result = builder.close();
    expect(result.name).toBe('Logo');
    expect(result.subpaths[0].closed).toBe(true);
    expect(result.subpaths[0].anchors).toHaveLength(2);
    expect(result.subpaths[0].anchors[1]).toMatchObject({
      position: { x: 30, y: 20 },
      handleIn: { x: 25, y: 15 },
      handleOut: { x: 35, y: 25 },
      mode: 'symmetric'
    });
  });

  it('cannot mutate after finishing', () => {
    const builder = PenPathBuilder.start(new SequentialIds());
    builder.place({ x: 0, y: 0 });
    builder.finishOpen();
    expect(() => builder.place({ x: 1, y: 1 })).toThrow(/already finished/);
  });
});

describe('vector selection state', () => {
  it('keeps anchor selection serializable and deterministic', () => {
    const first = { subpathId: 's', anchorId: 'a' };
    const second = { subpathId: 's', anchorId: 'b' };
    let state = selectAnchor(emptyVectorSelection(), first);
    state = selectAnchor(state, second, true);
    expect(state.anchors).toEqual([first, second]);
    state = toggleAnchorSelection(state, first);
    expect(state.anchors).toEqual([second]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('clears on an empty non-additive hit and selects fills as paths', () => {
    const state = selectHitTarget(emptyVectorSelection(), { kind: 'fill', pathId: 'p' });
    expect(state.pathIds).toEqual(['p']);
    expect(selectHitTarget(state, null)).toEqual(emptyVectorSelection());
  });
});

