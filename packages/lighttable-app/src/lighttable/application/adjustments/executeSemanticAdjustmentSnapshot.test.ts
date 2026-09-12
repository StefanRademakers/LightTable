import { describe, expect, it, vi } from 'vitest';
import {
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer,
  createRasterLayer
} from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createAdjustmentStackFromBasicAdjustments, materializeBasicAdjustments } from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createFilterStack } from '../../processing/filter';
import { createDefaultAdjustments } from '../../types';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { executeSemanticAdjustmentSnapshot } from './executeSemanticAdjustmentSnapshot';

const targetAdjustments = (
  document: ImageDocument,
  target: { kind: 'layer'; layerId: LayerId } | {
    kind: 'attached'; layerId: LayerId; adjustmentId: string;
  }
) => {
  const layer = findDocumentLayer(document, target.layerId);
  const stack = target.kind === 'attached' && layer?.type === 'raster'
    ? (layer.attachedAdjustments ?? []).find(({ id }) => id === target.adjustmentId)
        ?.adjustmentStack
    : layer?.type === 'raster' || layer?.type === 'adjustment'
      ? layer.adjustmentStack
      : null;
  return stack
    ? materializeBasicAdjustments(stack, undefined, undefined, true)
    : createDefaultAdjustments();
};

const harness = (initial: ImageDocument) => {
  let document = initial;
  const history: Array<{ undo(): void; redo(): void }> = [];
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: (entry) => history.push(entry)
  }));
  const processingPublish = vi.fn();
  const processingHistory = vi.fn();
  return {
    history, mutation, processingPublish, processingHistory,
    get document() { return document; },
    options: (target: Parameters<typeof executeSemanticAdjustmentSnapshot>[0]['target'], snapshot: ReturnType<typeof createDefaultAdjustments>) => ({
      document,
      assertMutationAllowed: vi.fn(),
      documentAdjustments: createDefaultAdjustments(),
      target,
      snapshot,
      changeDocument: mutation.change,
      publishDocumentProcessing: processingPublish,
      pushProcessingHistoryEntry: processingHistory
    })
  };
};

describe('semantic adjustment snapshot executor', () => {
  it('creates the first local Grade through shared document history', () => {
    const state = harness(createRasterLayer(createImageDocument('Fixture', 80, 60, 'source')));
    const layerId = state.document.activeLayerId!;
    const snapshot = createDefaultAdjustments();
    snapshot.exposureEV = 1.25;
    expect(executeSemanticAdjustmentSnapshot(state.options(
      { kind: 'layer', layerId }, snapshot
    )).changed).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.processingPublish).not.toHaveBeenCalled();
    expect(targetAdjustments(state.document, { kind: 'layer', layerId }).exposureEV).toBe(1.25);
    state.history[0]!.undo();
    expect(targetAdjustments(state.document, { kind: 'layer', layerId }).exposureEV).toBe(0);
  });

  it('keeps document processing on its explicit reversible owner', () => {
    const state = harness(createRasterLayer(createImageDocument('Fixture', 80, 60, 'source')));
    const snapshot = createDefaultAdjustments();
    snapshot.exposureEV = 1.5;
    expect(executeSemanticAdjustmentSnapshot(state.options(
      { kind: 'document', owner: 'grade' }, snapshot
    )).changed).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.processingPublish).toHaveBeenCalledWith(
      expect.objectContaining({ exposureEV: 1.5 }), 'grade'
    );
    const entry = state.processingHistory.mock.calls[0]?.[0];
    entry.undo(); entry.redo();
    expect(state.processingPublish).toHaveBeenCalledTimes(3);
  });

  it('addresses specialized layer and attached owners through document mutation', () => {
    const base = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const rasterId = base.activeLayerId!;
    const exposure = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()), 'exposure'
    );
    const withAttached = addRasterLayerAttachedAdjustment(base, rasterId, {
      id: 'exposure', adjustmentKind: 'exposure', name: 'Exposure', enabled: true,
      revision: 0, adjustmentStack: exposure
    });
    const withLayer = createAdjustmentLayer(withAttached, exposure, 'Exposure');
    const layerId = withLayer.activeLayerId!;
    const snapshot = createDefaultAdjustments();
    snapshot.photoshopAdjustment.kind = 'exposure';
    snapshot.photoshopAdjustment.exposure = 2;
    for (const target of [
      { kind: 'layer', layerId },
      { kind: 'attached', layerId: rasterId, adjustmentId: 'exposure' }
    ] as const) {
      const state = harness(withLayer);
      expect(executeSemanticAdjustmentSnapshot(state.options(target, snapshot)).changed).toBe(true);
      expect(state.history).toHaveLength(1);
      expect(targetAdjustments(state.document, target)
        .photoshopAdjustment.exposure).toBe(2);
    }
  });

  it('does not publish ignored snapshot fields for specialized or attached owners', () => {
    const base = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const rasterId = base.activeLayerId!;
    const levelsSnapshot = createDefaultAdjustments();
    levelsSnapshot.photoshopAdjustment.kind = 'levels';
    const levels = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(levelsSnapshot), 'levels'
    );
    const withAttached = addRasterLayerAttachedAdjustment(base, rasterId, {
      id: 'levels', adjustmentKind: 'levels', name: 'Levels', enabled: true,
      revision: 0, adjustmentStack: levels
    });
    const withLayer = createAdjustmentLayer(
      withAttached, levels, 'Levels', withAttached.activeLayerId!, 'levels'
    );
    const irrelevant = structuredClone(levelsSnapshot);
    irrelevant.exposureEV = 1.5;

    for (const target of [
      { kind: 'layer', layerId: withLayer.activeLayerId! },
      { kind: 'attached', layerId: rasterId, adjustmentId: 'levels' }
    ] as const) {
      const state = harness(withLayer);
      const before = state.document;
      expect(executeSemanticAdjustmentSnapshot(state.options(target, irrelevant)).changed)
        .toBe(false);
      expect(state.document).toBe(before);
      expect(state.document.revision).toBe(before.revision);
      expect(state.history).toHaveLength(0);
      expect(state.processingPublish).not.toHaveBeenCalled();
    }
  });

  it('rejects a snapshot whose kind differs from its canonical owner', () => {
    const base = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const levelsSnapshot = createDefaultAdjustments();
    levelsSnapshot.photoshopAdjustment.kind = 'levels';
    const levels = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(levelsSnapshot), 'levels'
    );
    const withLayer = createAdjustmentLayer(base, levels, 'Levels', base.activeLayerId!, 'levels');
    const state = harness(withLayer);
    const threshold = createDefaultAdjustments();
    threshold.photoshopAdjustment.kind = 'threshold';
    expect(() => executeSemanticAdjustmentSnapshot(state.options(
      { kind: 'layer', layerId: withLayer.activeLayerId! }, threshold
    ))).toThrow('snapshot kind does not match');
    expect(state.history).toHaveLength(0);
  });

  it('rejects filter-only owners that require typed filter commands', () => {
    const base = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const filter = createFilterStack('gaussian-blur', { radius: 8 }, (part) => `blur-${part}`);
    const withLayer = createAdjustmentLayer(
      base, filter, 'Gaussian Blur', base.activeLayerId!, 'gaussian-blur'
    );
    const state = harness(withLayer);
    expect(findDocumentLayer(withLayer, withLayer.activeLayerId!)?.type).toBe('adjustment');
    expect(() => executeSemanticAdjustmentSnapshot(state.options(
      { kind: 'layer', layerId: withLayer.activeLayerId! }, createDefaultAdjustments()
    ))).toThrow('typed filter command');
    expect(state.history).toHaveLength(0);
  });
});
