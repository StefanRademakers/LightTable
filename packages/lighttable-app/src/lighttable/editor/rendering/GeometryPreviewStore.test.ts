import { describe, expect, it } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { identityAffineMatrix } from './renderContract';
import { GeometryPreviewStore } from './GeometryPreviewStore';

const layerId = 'layer-1' as LayerId;

describe('GeometryPreviewStore', () => {
  it('returns a defensive preview for the matching source revision', () => {
    const store = new GeometryPreviewStore();
    const matrix = identityAffineMatrix();
    matrix.tx = 12;
    store.set(layerId, 4, matrix);
    matrix.tx = 99;

    expect(store.resolve(layerId, 4)?.tx).toBe(12);
  });

  it('invalidates a preview when canonical geometry changes', () => {
    const store = new GeometryPreviewStore();
    store.set(layerId, 4, identityAffineMatrix());

    expect(store.resolve(layerId, 5)).toBeNull();
    expect(store.resolve(layerId, 4)).toBeNull();
  });

  it('reports whether clearing changed presentation state', () => {
    const store = new GeometryPreviewStore();
    expect(store.clear()).toBe(false);
    store.set(layerId, 1, identityAffineMatrix());
    expect(store.clear()).toBe(true);
    expect(store.clear()).toBe(false);
  });
});
