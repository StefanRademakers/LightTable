import { describe, expect, it } from 'vitest';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createVectorLayer } from '../document/documentTypes';
import { VectorContentPreviewStore } from './VectorContentPreviewStore';

describe('VectorContentPreviewStore', () => {
  it('returns preview content only while its canonical layer revision matches', () => {
    const source = createVectorLayer([createVectorLiveShape('shape', {
      kind: 'ellipse', width: 20, height: 20
    })]);
    const preview = {
      ...source,
      elements: source.elements.map((element) => ({
        ...element,
        transform: { ...element.transform, tx: 24 },
        transformRevision: element.transformRevision + 1
      }))
    };
    const store = new VectorContentPreviewStore();
    expect(store.replace([preview])).toBe(true);
    expect(store.resolve(source)?.elements[0]?.transform.tx).toBe(24);

    expect(store.resolve({ ...source, revision: source.revision + 1 })).toBeNull();
    expect(store.resolve(source)).toBeNull();
  });

  it('atomically replaces and clears a multi-layer preview set', () => {
    const first = createVectorLayer([]);
    const second = createVectorLayer([]);
    const store = new VectorContentPreviewStore();
    store.replace([first, second]);
    store.replace([second]);

    expect(store.resolve(first)).toBeNull();
    expect(store.resolve(second)).toBe(second);
    expect(store.clear()).toBe(true);
    expect(store.clear()).toBe(false);
  });
});
