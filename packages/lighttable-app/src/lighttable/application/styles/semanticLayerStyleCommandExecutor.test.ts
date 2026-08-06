import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import { parseSemanticLayerStyleCommand } from '../commands/semanticLayerStyleCommandContract';
import { executeSemanticLayerStyleCommand } from './semanticLayerStyleCommandExecutor';

const harness = () => {
  let document = createRasterLayer(createImageDocument('Styles', 100, 100, 'fixture'));
  const history = vi.fn();
  const dependencies = { getDocument: () => document,
    applyDocument: (next: typeof document) => { document = next; }, recordHistory: history };
  return { dependencies, history, document: () => document };
};
const kinds: LayerStyleKind[] = ['drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow',
  'bevel-emboss', 'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke'];

describe('semantic Layer Style commands', () => {
  it('adds every supported effect and updates, moves, toggles and removes by stable id', () => {
    const state = harness(); const layerId = state.document().activeLayerId!;
    const ids = kinds.map((effectKind) => executeSemanticLayerStyleCommand(
      { kind: 'add', layerId, effectKind }, state.dependencies)!.effectId);
    let layer = findDocumentLayer(state.document(), layerId)!;
    expect(layer.styleStack.effects.map(({ kind }) => kind)).toEqual(kinds);

    executeSemanticLayerStyleCommand({ kind: 'update', layerId, effectId: ids[0],
      settings: { distance: 42, size: 18, spread: 0.25 } }, state.dependencies);
    executeSemanticLayerStyleCommand({ kind: 'toggle', layerId, effectId: ids[0], enabled: false }, state.dependencies);
    executeSemanticLayerStyleCommand({ kind: 'move', layerId, effectId: ids[0], targetIndex: 9 }, state.dependencies);
    executeSemanticLayerStyleCommand({ kind: 'remove', layerId, effectId: ids[1] }, state.dependencies);
    layer = findDocumentLayer(state.document(), layerId)!;
    expect(layer.styleStack.effects.at(-1)).toMatchObject({ id: ids[0], enabled: false, distance: 42, size: 18 });
    expect(layer.styleStack.effects.some(({ id }) => id === ids[1])).toBe(false);
    expect(state.history).toHaveBeenCalledTimes(14);
  });

  it('rejects non-finite and oversized settings at the boundary', () => {
    expect(parseSemanticLayerStyleCommand('update', { layerId: 'layer', effectId: 'effect',
      settings: { size: Number.NaN } })).toHaveProperty('message');
    expect(parseSemanticLayerStyleCommand('update', { layerId: 'layer', effectId: 'effect',
      settings: { contour: Array.from({ length: 65 }, () => 0) } })).toHaveProperty('message');
  });
});
