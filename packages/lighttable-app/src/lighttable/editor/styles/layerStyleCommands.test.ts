import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { findDocumentLayer } from '../document/layerTree';
import {
  addLayerStyle,
  clearLayerStyles,
  moveLayerStyle,
  setLayerStyleEnabled,
  setLayerStyleGlobalLight,
  setLayerStyleScale,
  updateLayerStyle
} from './layerStyleCommands';

const documentWithLayer = () => createImageDocument('Styles', 320, 180, 'asset');

describe('LightTable Layer Style commands', () => {
  it('supports multiple same-kind effects with stable ids', () => {
    const document = documentWithLayer();
    const layerId = document.activeLayerId!;
    const withTwoShadows = addLayerStyle(
      addLayerStyle(document, layerId, 'drop-shadow'),
      layerId,
      'drop-shadow'
    );
    const layer = findDocumentLayer(withTwoShadows, layerId)!;
    expect(layer.styleStack.effects).toHaveLength(2);
    expect(new Set(layer.styleStack.effects.map(({ id }) => id)).size).toBe(2);
  });

  it('updates, toggles, reorders and clears effects without mutating its input', () => {
    const document = documentWithLayer();
    const layerId = document.activeLayerId!;
    const withStyles = addLayerStyle(
      addLayerStyle(document, layerId, 'color-overlay'),
      layerId,
      'stroke'
    );
    const before = structuredClone(withStyles);
    const colorId = findDocumentLayer(withStyles, layerId)!.styleStack.effects[0].id;
    const strokeId = findDocumentLayer(withStyles, layerId)!.styleStack.effects[1].id;
    const updated = updateLayerStyle(withStyles, layerId, colorId, (effect) => ({
      ...effect,
      opacity: 0.42
    }));
    const disabled = setLayerStyleEnabled(updated, layerId, colorId, false);
    const moved = moveLayerStyle(disabled, layerId, strokeId, 0);
    const layer = findDocumentLayer(moved, layerId)!;
    expect(layer.styleStack.effects.map(({ id }) => id)).toEqual([strokeId, colorId]);
    expect(layer.styleStack.effects[1]).toMatchObject({ opacity: 0.42, enabled: false });
    expect(withStyles).toEqual(before);
    expect(findDocumentLayer(clearLayerStyles(moved, layerId), layerId)!.styleStack.effects).toEqual([]);
  });

  it('normalizes scale and global-light inputs', () => {
    const document = documentWithLayer();
    const layerId = document.activeLayerId!;
    const scaled = setLayerStyleScale(document, layerId, 99);
    const lit = setLayerStyleGlobalLight(scaled, layerId, { angle: -30, altitude: 120 });
    expect(findDocumentLayer(lit, layerId)!.styleStack).toMatchObject({
      scale: 10,
      globalLight: { angle: 330, altitude: 90 }
    });
  });
});
