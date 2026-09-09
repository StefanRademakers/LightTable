import { describe, expect, it, vi } from 'vitest';
import {
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer,
  createRasterLayer
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createFilterStack } from '../../processing/filter';
import { createDefaultAdjustments } from '../../types';
import { executeSemanticAdjustmentSnapshot } from './executeSemanticAdjustmentSnapshot';

describe('semantic adjustment snapshot executor', () => {
  it('creates the first local Grade state on a plain raster and keeps it reversible', () => {
    const document = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const layerId = document.activeLayerId!;
    const layer = findDocumentLayer(document, layerId);
    expect(layer?.type === 'raster' ? layer.adjustmentStack : undefined).toBeNull();
    const snapshot = createDefaultAdjustments();
    snapshot.exposureEV = 1.25;
    const publish = vi.fn();
    let history: { undo(): void; redo(): void } | null = null;
    expect(executeSemanticAdjustmentSnapshot({
      document, documentAdjustments: createDefaultAdjustments(),
      target: { kind: 'layer', layerId }, snapshot, publish,
      pushHistoryEntry: (entry) => { history = entry; }
    }).changed).toBe(true);
    history!.undo(); history!.redo();
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls.map(([value]) => value.exposureEV)).toEqual([1.25, 0, 1.25]);
  });

  it('publishes one reversible document-owner transaction', () => {
    const document = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const before = createDefaultAdjustments();
    const after = createDefaultAdjustments();
    after.exposureEV = 1.5;
    const publish = vi.fn();
    const pushHistoryEntry = vi.fn();
    expect(executeSemanticAdjustmentSnapshot({
      document, documentAdjustments: before,
      target: { kind: 'document', owner: 'grade' }, snapshot: after,
      publish, pushHistoryEntry
    })).toEqual({ target: { kind: 'document', owner: 'grade' }, changed: true });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ exposureEV: 1.5 }), null, 'grade'
    );
    const history = pushHistoryEntry.mock.calls[0]?.[0];
    history.undo(); history.redo();
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('changes only the addressed document owner through commit, undo and redo', () => {
    const document = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const current = createDefaultAdjustments();
    current.effects.grain.enabled = true;
    current.effects.grain.amount = 0.75;
    const incoming = createDefaultAdjustments();
    incoming.exposureEV = 2;
    incoming.effects.grain.enabled = false;
    incoming.effects.grain.amount = 9;
    const published: ReturnType<typeof createDefaultAdjustments>[] = [];
    let history: { undo(): void; redo(): void } | null = null;
    executeSemanticAdjustmentSnapshot({
      document, documentAdjustments: current,
      target: { kind: 'document', owner: 'grade' }, snapshot: incoming,
      publish: (snapshot) => published.push(snapshot),
      pushHistoryEntry: (entry) => { history = entry; }
    });
    history!.undo(); history!.redo();
    expect(published.map(({ exposureEV }) => exposureEV)).toEqual([2, 0, 2]);
    expect(published.every(({ effects }) => (
      effects.grain.enabled && effects.grain.amount === 0.75
    ))).toBe(true);
  });

  it('addresses a specialized layer and attached adjustment without panel state', () => {
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
    expect(findDocumentLayer(withLayer, layerId)?.type).toBe('adjustment');
    const snapshot = createDefaultAdjustments();
    snapshot.photoshopAdjustment.kind = 'exposure';
    snapshot.photoshopAdjustment.exposure = 2;
    const publish = vi.fn();
    for (const target of [
      { kind: 'layer', layerId },
      { kind: 'attached', layerId: rasterId, adjustmentId: 'exposure' }
    ] as const) {
      publish.mockClear();
      expect(executeSemanticAdjustmentSnapshot({
        document: withLayer, documentAdjustments: createDefaultAdjustments(),
        target, snapshot, publish, pushHistoryEntry: vi.fn()
      }).changed).toBe(true);
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ photoshopAdjustment: expect.objectContaining({ exposure: 2 }) }),
        expect.any(String), 'all'
      );
    }
  });

  it('rejects a snapshot whose Photoshop kind differs from its canonical owner', () => {
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
    const layerId = withLayer.activeLayerId!;
    const threshold = createDefaultAdjustments();
    threshold.photoshopAdjustment.kind = 'threshold';
    for (const target of [
      { kind: 'layer', layerId },
      { kind: 'attached', layerId: rasterId, adjustmentId: 'levels' }
    ] as const) {
      expect(() => executeSemanticAdjustmentSnapshot({
        document: withLayer, documentAdjustments: createDefaultAdjustments(),
        target, snapshot: threshold, publish: vi.fn(), pushHistoryEntry: vi.fn()
      })).toThrow('snapshot kind does not match');
    }
  });

  it('rejects filter-only layer and attached owners that require typed filter commands', () => {
    const base = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const rasterId = base.activeLayerId!;
    const filter = createFilterStack('gaussian-blur', { radius: 8 }, (part) => `blur-${part}`);
    const withAttached = addRasterLayerAttachedAdjustment(base, rasterId, {
      id: 'blur', adjustmentKind: 'gaussian-blur', name: 'Gaussian Blur', enabled: true,
      revision: 0, adjustmentStack: filter
    });
    const withLayer = createAdjustmentLayer(
      withAttached, filter, 'Gaussian Blur', withAttached.activeLayerId!, 'gaussian-blur'
    );
    const snapshot = createDefaultAdjustments();
    for (const target of [
      { kind: 'layer', layerId: withLayer.activeLayerId! },
      { kind: 'attached', layerId: rasterId, adjustmentId: 'blur' }
    ] as const) {
      const publish = vi.fn();
      const pushHistoryEntry = vi.fn();
      expect(() => executeSemanticAdjustmentSnapshot({
        document: withLayer, documentAdjustments: snapshot, target, snapshot,
        publish, pushHistoryEntry
      })).toThrow('typed filter command');
      expect(publish).not.toHaveBeenCalled();
      expect(pushHistoryEntry).not.toHaveBeenCalled();
    }
  });
});
