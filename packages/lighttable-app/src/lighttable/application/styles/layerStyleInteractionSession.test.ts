import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { addLayerStyleFixture } from '../../editor/styles/layerStyleTestFixtures';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createLayerStyleInteractionSession } from './layerStyleInteractionSession';

const setup = () => {
  let document = createRasterLayer(createImageDocument('Styles', 64, 64, 'source'));
  const layerId = document.activeLayerId!;
  document = addLayerStyleFixture(document, layerId, 'drop-shadow');
  const rendererA = { setLayerStyleInteractionActive: vi.fn() };
  const rendererB = { setLayerStyleInteractionActive: vi.fn() };
  let renderer = rendererA;
  let rendererGeneration = 1;
  let preview: typeof document | null = null;
  const history = vi.fn();
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: (next) => { preview = next; },
    discardPreview: () => { preview = null; },
    pushHistoryEntry: history
  }));
  const checkpoint = vi.fn();
  const canceled = vi.fn();
  const session = createLayerStyleInteractionSession(() => ({
    getDocument: () => document,
    getRenderer: () => renderer,
    getRendererGeneration: () => rendererGeneration,
    documentMutations: mutations,
    onCheckpoint: checkpoint,
    onCanceled: canceled
  }));
  return {
    session, layerId, rendererA, rendererB, history, checkpoint, canceled,
    document: () => document, preview: () => preview,
    useRendererB: () => { renderer = rendererB; rendererGeneration += 1; },
    replaceRendererGeneration: () => { rendererGeneration += 1; }
  };
};

describe('Layer Style interaction session', () => {
  it('previews renderer-only and commits one canonical history checkpoint', () => {
    const state = setup();
    const request = { layerId: state.layerId, before: state.document() };
    const stack = structuredClone(findDocumentLayer(state.document(), state.layerId)!.styleStack);
    stack.effects[0] = { ...stack.effects[0], size: 80 } as never;
    stack.revision += 1;

    const handle = state.session.begin(request);
    expect(handle).not.toBeNull();
    expect(state.session.preview(request, stack, handle!)).toBe(true);
    expect(findDocumentLayer(state.document(), state.layerId)!.styleStack.effects[0])
      .not.toMatchObject({ size: 80 });
    expect(findDocumentLayer(state.preview()!, state.layerId)!.styleStack.effects[0])
      .toMatchObject({ size: 80 });
    expect(state.session.commit(handle!)).toBe(true);
    expect(findDocumentLayer(state.document(), state.layerId)!.styleStack.effects[0])
      .toMatchObject({ size: 80 });
    expect(state.history).toHaveBeenCalledOnce();
    expect(state.checkpoint).toHaveBeenCalledOnce();
    expect(state.rendererA.setLayerStyleInteractionActive.mock.calls).toEqual([
      [true, state.layerId], [false, state.layerId]
    ]);
  });

  it('cancels against the admitted renderer when a rebind occurs', () => {
    const state = setup();
    const request = { layerId: state.layerId, before: state.document() };
    const stack = structuredClone(findDocumentLayer(state.document(), state.layerId)!.styleStack);
    stack.enabled = false;
    stack.revision += 1;
    const handle = state.session.begin(request);
    expect(handle).not.toBeNull();
    expect(state.session.preview(request, stack, handle!)).toBe(true);

    state.useRendererB();
    expect(state.session.commit(handle!)).toBe(false);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.rendererA.setLayerStyleInteractionActive.mock.calls).toEqual([
      [true, state.layerId], [false, state.layerId]
    ]);
    expect(state.rendererB.setLayerStyleInteractionActive).not.toHaveBeenCalled();
    expect(state.canceled).toHaveBeenCalledWith('cancel');
  });

  it('proactively closes interactive quality when the renderer generation changes', () => {
    const state = setup();
    expect(state.session.begin({ layerId: state.layerId, before: state.document() })).not.toBeNull();
    state.replaceRendererGeneration();
    expect(state.session.reconcileBinding()).toBe(false);
    expect(state.session.active).toBe(false);
    expect(state.rendererA.setLayerStyleInteractionActive.mock.calls).toEqual([
      [true, state.layerId], [false, state.layerId]
    ]);
    expect(state.canceled).toHaveBeenCalledWith('cancel');
    expect(state.history).not.toHaveBeenCalled();
  });

  it('rejects an overlapping child gesture without transferring the active lease', () => {
    const state = setup();
    const layer = findDocumentLayer(state.document(), state.layerId)!;
    const effectId = layer.styleStack.effects[0].id;
    const first = state.session.begin({ layerId: state.layerId, before: state.document() });
    expect(first).not.toBeNull();
    expect(state.session.begin({ layerId: state.layerId, effectId, before: state.document() })).toBeNull();
    const stack = structuredClone(layer.styleStack);
    stack.enabled = false;
    stack.revision += 1;
    expect(state.session.preview(
      { layerId: state.layerId, before: state.document() }, stack, first!
    )).toBe(true);
    expect(state.session.commit(first!)).toBe(true);
    expect(state.rendererA.setLayerStyleInteractionActive.mock.calls).toEqual([
      [true, state.layerId], [false, state.layerId]
    ]);
    expect(state.history).toHaveBeenCalledOnce();
  });

  it('does not admit a locked style owner', () => {
    const state = setup();
    const locked = state.document();
    locked.layers = locked.layers.map((layer) => layer.id === state.layerId
      ? { ...layer, locks: { ...layer.locks, all: true } }
      : layer);
    expect(state.session.begin({ layerId: state.layerId, before: locked })).toBeNull();
    expect(state.rendererA.setLayerStyleInteractionActive).not.toHaveBeenCalled();
  });

  it('makes stale preview and terminal callbacks inert after a newer gesture starts', () => {
    const state = setup();
    const request = { layerId: state.layerId, before: state.document() };
    const first = state.session.begin(request)!;
    state.session.cancel(first);
    const second = state.session.begin(request)!;
    const stack = structuredClone(findDocumentLayer(state.document(), state.layerId)!.styleStack);
    stack.enabled = false;
    stack.revision += 1;

    expect(state.session.preview(request, stack, first)).toBe(false);
    expect(state.session.commit(first)).toBe(false);
    expect(state.session.cancel(first)).toBe(false);
    expect(state.session.preview(request, stack, second)).toBe(true);
    expect(state.session.commit(second)).toBe(true);
    expect(state.history).toHaveBeenCalledOnce();
  });

  it('cancels the disposable projection when terminal validation fails', () => {
    const state = setup();
    const request = { layerId: state.layerId, before: state.document() };
    const handle = state.session.begin(request)!;
    const stack = structuredClone(findDocumentLayer(state.document(), state.layerId)!.styleStack);
    stack.scale = Number.NaN;
    expect(state.session.preview(request, stack, handle)).toBe(true);

    expect(() => state.session.commit(handle)).toThrow(/canonical bounds/i);
    expect(state.session.active).toBe(false);
    expect(state.preview()).toBeNull();
    expect(state.history).not.toHaveBeenCalled();
  });
});
