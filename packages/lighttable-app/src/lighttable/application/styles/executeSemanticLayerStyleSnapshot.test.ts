import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDefaultLayerStyle } from '../../editor/styles/layerStyleDefaults';
import { layerStyleSnapshot } from './completeLayerStyleSnapshot';
import { executeSemanticLayerStyleSnapshot } from './executeSemanticLayerStyleSnapshot';

const setup = () => {
  let document = createRasterLayer(createImageDocument('Styles', 64, 64, 'source'));
  const layerId = document.activeLayerId!;
  const changeDocument = (change: (value: typeof document) => typeof document) => {
    const next = change(document);
    const changed = next !== document;
    document = next;
    return changed;
  };
  return { layerId, document: () => document, changeDocument };
};

describe('semantic Layer Style snapshot execution', () => {
  it('replaces the complete ordered stack with one document mutation', () => {
    const state = setup();
    const before = findDocumentLayer(state.document(), state.layerId)!;
    const snapshot = layerStyleSnapshot(before.styleStack);
    snapshot.enabled = false;
    snapshot.scale = 1.5;
    snapshot.effects = ['stroke', 'drop-shadow'].map((kind) => (
      createDefaultLayerStyle(kind as 'stroke' | 'drop-shadow')
    ));
    const result = executeSemanticLayerStyleSnapshot(
      { layerId: state.layerId, snapshot }, state
    );
    const after = findDocumentLayer(state.document(), state.layerId)!;
    expect(result).toEqual({ layerId: state.layerId, changed: true });
    expect(layerStyleSnapshot(after.styleStack)).toEqual(snapshot);
    expect(after.styleStack.revision).toBe(before.styleStack.revision + 1);
  });

  it('is a no-op for an identical snapshot and rejects a locked owner', () => {
    const state = setup();
    const snapshot = layerStyleSnapshot(
      findDocumentLayer(state.document(), state.layerId)!.styleStack
    );
    expect(executeSemanticLayerStyleSnapshot(
      { layerId: state.layerId, snapshot }, state
    ).changed).toBe(false);
    state.changeDocument((document) => ({
      ...document,
      layers: document.layers.map((layer) => layer.id === state.layerId
        ? { ...layer, locks: { ...layer.locks, all: true } }
        : layer)
    }));
    expect(() => executeSemanticLayerStyleSnapshot(
      { layerId: state.layerId, snapshot: { ...snapshot, enabled: false } }, state
    )).toThrow('locked');
  });

  it('does not author history for an identical snapshot with reordered object keys', () => {
    const state = setup();
    const current = layerStyleSnapshot(
      findDocumentLayer(state.document(), state.layerId)!.styleStack
    );
    const reordered = {
      effects: current.effects,
      globalLight: { altitude: current.globalLight.altitude, angle: current.globalLight.angle },
      scale: current.scale,
      enabled: current.enabled
    };
    expect(executeSemanticLayerStyleSnapshot(
      { layerId: state.layerId, snapshot: reordered }, state
    ).changed).toBe(false);
  });
});
