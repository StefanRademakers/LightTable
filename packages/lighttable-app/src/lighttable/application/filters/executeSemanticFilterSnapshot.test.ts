import { describe, expect, it, vi } from 'vitest';
import { defaultFilterSettings } from '@lighttable/filter-core';
import {
  createAdjustmentLayer,
  createRasterLayer,
  setLayerLocked
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createFilterStack } from '../../processing/filter';
import { executeSemanticFilterSnapshot } from './executeSemanticFilterSnapshot';

const harness = () => {
  let document = createRasterLayer(createImageDocument('Filters', 100, 100, 'fixture'));
  const rasterId = document.activeLayerId!;
  document = createAdjustmentLayer(
    document, createFilterStack('gaussian-blur'), 'Gaussian Blur', rasterId, 'gaussian-blur'
  );
  const layerId = document.activeLayerId!;
  const history = vi.fn();
  return {
    rasterId,
    layerId,
    history,
    document: () => document,
    dependencies: { changeDocument: (change: (source: typeof document) => typeof document) => {
      const before = document;
      const after = change(before);
      if (after === before) return false;
      document = after;
      history(before, after);
      return true;
    } }
  };
};

describe('semantic filter snapshot executor', () => {
  it('atomically applies one exact layer snapshot and treats replay as a no-op', () => {
    const state = harness();
    const command = {
      target: { kind: 'layer' as const, layerId: state.layerId },
      snapshot: {
        kind: 'gaussian-blur' as const,
        enabled: false,
        settings: { radius: 42 }
      }
    };
    expect(executeSemanticFilterSnapshot(command, state.dependencies).changed).toBe(true);
    expect(executeSemanticFilterSnapshot(command, state.dependencies).changed).toBe(false);
    const layer = findDocumentLayer(state.document(), state.layerId);
    expect(layer?.type === 'adjustment' ? layer.adjustmentStack.modules[0] : null)
      .toMatchObject({ enabled: false, settings: { radius: 42 } });
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('rejects a kind mismatch and locked owner without publication', () => {
    const state = harness();
    expect(() => executeSemanticFilterSnapshot({
      target: { kind: 'layer', layerId: state.layerId },
      snapshot: { kind: 'median', enabled: true, settings: defaultFilterSettings('median') }
    }, state.dependencies)).toThrow(/kind/i);
    state.dependencies.changeDocument((document) => setLayerLocked(
      document, state.layerId, true
    ));
    expect(() => executeSemanticFilterSnapshot({
      target: { kind: 'layer', layerId: state.layerId },
      snapshot: { kind: 'gaussian-blur', enabled: true,
        settings: defaultFilterSettings('gaussian-blur') }
    }, state.dependencies)).toThrow(/locked|exist/i);
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing Displace map and accepts a raster in the same document', () => {
    const state = harness();
    state.dependencies.changeDocument((document) => createAdjustmentLayer(
      document,
      createFilterStack('displace'),
      'Displace',
      document.activeLayerId!,
      'displace'
    ));
    const layerId = state.document().activeLayerId!;
    const base = defaultFilterSettings('displace');
    expect(() => executeSemanticFilterSnapshot({
      target: { kind: 'layer', layerId },
      snapshot: { kind: 'displace', enabled: true,
        settings: { ...base, mapAssetId: 'missing-raster' } }
    }, state.dependencies)).toThrow(/displacement map/i);
    expect(executeSemanticFilterSnapshot({
      target: { kind: 'layer', layerId },
      snapshot: { kind: 'displace', enabled: true,
        settings: { ...base, mapAssetId: state.rasterId } }
    }, state.dependencies).changed).toBe(true);
  });
});
