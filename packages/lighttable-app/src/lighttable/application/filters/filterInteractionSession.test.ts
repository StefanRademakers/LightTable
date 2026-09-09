import { describe, expect, it, vi } from 'vitest';
import { createAdjustmentLayer, createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createFilterStack } from '../../processing/filter';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createFilterInteractionSession } from './filterInteractionSession';

const setup = () => {
  let document = createRasterLayer(createImageDocument('Filters', 64, 64, 'source'));
  document = createAdjustmentLayer(document, createFilterStack('gaussian-blur'),
    'Gaussian Blur', document.activeLayerId!, 'gaussian-blur');
  const layerId = document.activeLayerId!;
  const rendererA = {};
  const rendererB = {};
  let renderer = rendererA;
  let rendererGeneration = 1;
  let preview: typeof document | null = null;
  const history = vi.fn();
  const checkpoint = vi.fn();
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: (next) => { preview = next; },
    discardPreview: () => { preview = null; },
    pushHistoryEntry: history
  }));
  const session = createFilterInteractionSession(() => ({
    getDocument: () => document,
    getRenderer: () => renderer,
    getRendererGeneration: () => rendererGeneration,
    documentMutations: mutations,
    onCheckpoint: checkpoint
  }));
  return {
    layerId, session, history, checkpoint,
    document: () => document, preview: () => preview,
    rebind: () => { renderer = rendererB; rendererGeneration += 1; }
  };
};

describe('filter interaction session', () => {
  it('keeps preview disposable and commits exactly one history checkpoint', () => {
    const state = setup();
    const target = { kind: 'layer' as const, layerId: state.layerId };
    expect(state.session.preview(target, {
      kind: 'gaussian-blur', enabled: true, settings: { radius: 24 }
    })).toBe(true);
    expect(state.session.preview(target, {
      kind: 'gaussian-blur', enabled: true, settings: { radius: 48 }
    })).toBe(true);
    const committedLayer = findDocumentLayer(state.document(), state.layerId);
    expect(committedLayer?.type === 'adjustment'
      ? committedLayer.adjustmentStack.modules[0].settings
      : null).not.toMatchObject({ radius: 48 });
    const previewLayer = findDocumentLayer(state.preview()!, state.layerId);
    expect(previewLayer?.type === 'adjustment'
      ? previewLayer.adjustmentStack.modules[0].settings
      : null).toMatchObject({ radius: 48 });
    expect(previewLayer?.type === 'adjustment'
      ? previewLayer.adjustmentStack.revision
      : null).toBe((committedLayer?.type === 'adjustment'
      ? committedLayer.adjustmentStack.revision
      : 0) + 2);
    expect(state.session.commit()).toBe(true);
    const finalLayer = findDocumentLayer(state.document(), state.layerId);
    expect(finalLayer?.type === 'adjustment'
      ? finalLayer.adjustmentStack.revision
      : null).toBe((committedLayer?.type === 'adjustment'
      ? committedLayer.adjustmentStack.revision
      : 0) + 1);
    expect(state.history).toHaveBeenCalledOnce();
    expect(state.checkpoint).toHaveBeenCalledOnce();
  });

  it('cancels without history when renderer generation changes', () => {
    const state = setup();
    expect(state.session.preview({ kind: 'layer', layerId: state.layerId }, {
      kind: 'gaussian-blur', enabled: true, settings: { radius: 48 }
    })).toBe(true);
    state.rebind();
    expect(state.session.reconcileBinding()).toBe(false);
    expect(state.session.active).toBe(false);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.checkpoint).not.toHaveBeenCalled();
  });
});
