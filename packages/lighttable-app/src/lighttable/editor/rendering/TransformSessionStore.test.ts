import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { identityAffineMatrix } from './renderContract';
import {
  TransformSessionStore,
  type TransformGpuSession
} from './TransformSessionStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const buffer = () => ({ destroy: vi.fn() }) as unknown as GPUBuffer;

const session = (usesSelection = true): TransformGpuSession => ({
  layerId: 'layer-1' as LayerId,
  matrix: identityAffineMatrix(),
  sourceTexture: texture(),
  selectionTexture: usesSelection ? texture() : null,
  previewTexture: texture(),
  selectionPreview: usesSelection ? texture() : null,
  settingsBuffer: buffer(),
  usesSelection
});

describe('TransformSessionStore', () => {
  it('allows only one in-flight transform', () => {
    const store = new TransformSessionStore();
    const active = session();
    store.begin(active);
    expect(store.current).toBe(active);
    expect(() => store.begin(session())).toThrow('Finish or cancel');
  });

  it('transfers history snapshots while releasing preview resources', () => {
    const store = new TransformSessionStore();
    const active = session();
    store.begin(active);
    const history = store.complete();

    expect(history?.sourceTexture).toBe(active.sourceTexture);
    expect(history?.selectionTexture).toBe(active.selectionTexture);
    expect(active.sourceTexture.destroy).not.toHaveBeenCalled();
    expect(active.selectionTexture?.destroy).not.toHaveBeenCalled();
    expect(active.previewTexture.destroy).toHaveBeenCalledOnce();
    expect(active.selectionPreview?.destroy).toHaveBeenCalledOnce();
    expect(active.settingsBuffer.destroy).toHaveBeenCalledOnce();
    expect(store.current).toBeNull();
  });

  it('cancels and destroys every owned resource', () => {
    const store = new TransformSessionStore();
    const active = session();
    store.begin(active);
    expect(store.estimatedTextureBytes(80, 10)).toBe(180);
    expect(store.cancel()).toBe(true);
    [
      active.sourceTexture,
      active.selectionTexture,
      active.previewTexture,
      active.selectionPreview,
      active.settingsBuffer
    ].forEach((resource) => expect(resource?.destroy).toHaveBeenCalledOnce());
    expect(store.cancel()).toBe(false);
  });
});
