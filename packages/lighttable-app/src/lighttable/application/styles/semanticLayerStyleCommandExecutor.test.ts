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
  const dependencies = { changeDocument: (change: (current: typeof document) => typeof document) => {
    const before = document;
    const next = change(before);
    if (next === before) return false;
    document = next;
    history(before, next);
    return true;
  } };
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
    expect(parseSemanticLayerStyleCommand('add', { layerId: 'layer', effectKind: 'stroke',
      settings: { distance: 12 } })).toHaveProperty('message');
    expect(parseSemanticLayerStyleCommand('remove', { layerId: 'layer', effectId: 'effect',
      pointerState: {} })).toHaveProperty('message');
  });

  it('rejects a valid known setting when it belongs to another target effect kind', () => {
    const state = harness(); const layerId = state.document().activeLayerId!;
    const effectId = executeSemanticLayerStyleCommand(
      { kind: 'add', layerId, effectKind: 'stroke' }, state.dependencies
    )!.effectId;
    expect(() => executeSemanticLayerStyleCommand({
      kind: 'update', layerId, effectId, settings: { distance: 12 }
    }, state.dependencies)).toThrow(/target effect kind/i);
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('updates bounded stack-wide scale and global light without replacing effects', () => {
    const state = harness(); const layerId = state.document().activeLayerId!;
    executeSemanticLayerStyleCommand({ kind: 'add', layerId, effectKind: 'drop-shadow' }, state.dependencies);
    const result = executeSemanticLayerStyleCommand({ kind: 'stack-update', layerId,
      settings: { scale: 1.5, globalLight: { angle: 210, altitude: 45 } } }, state.dependencies);
    expect(result).toEqual({ layerId, settings: {
      scale: 1.5, globalLight: { angle: 210, altitude: 45 }
    } });
    expect(findDocumentLayer(state.document(), layerId)?.styleStack).toMatchObject({
      scale: 1.5, globalLight: { angle: 210, altitude: 45 }, effects: [{ kind: 'drop-shadow' }]
    });
    expect(state.history).toHaveBeenCalledTimes(2);
  });
});
