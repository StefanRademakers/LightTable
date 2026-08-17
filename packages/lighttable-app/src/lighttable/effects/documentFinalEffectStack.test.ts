import { describe, expect, it } from 'vitest';
import {
  createAdjustmentLayer,
  createImageDocument
} from '../editor/document/documentTypes';
import {
  createAdjustmentStackFromBasicAdjustments
} from '../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../processing/adjustmentLayerCatalog';
import { createDefaultAdjustments } from '../types';
import {
  adjustmentLayerOwnsDocumentFinalEffects,
  adjustmentLayerUsesDocumentFinalEffects,
  composeDocumentFinalEffectStack
} from './documentFinalEffectStack';

describe('document-final Lens FX stack', () => {
  it('keeps a Lens FX layer as one logical stage-ordered document pass', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const settings = createDefaultAdjustments();
    settings.effects.lensBlur.enabled = true;
    settings.effects.grain.enabled = true;
    const lensFx = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(settings),
      'lens-fx'
    );
    const layer = createAdjustmentLayer(lensFx, 'Lens Fx', 'lens-fx');
    const document = createImageDocument('Test', 32, 32, 'asset');
    document.layers.push(layer);

    expect(adjustmentLayerOwnsDocumentFinalEffects(layer)).toBe(true);
    expect(adjustmentLayerUsesDocumentFinalEffects(layer)).toBe(true);
    const composed = composeDocumentFinalEffectStack(base, document);
    const layerTypes = new Set(lensFx.modules.map(({ type }) => type));
    const appended = composed.modules.filter(({ id }) =>
      lensFx.modules.some((module) => module.id === id)
    );
    expect(new Set(appended.map(({ type }) => type))).toEqual(layerTypes);
    expect(appended.at(-1)?.type).toBe('lt.grain');
    expect(appended.findIndex(({ type }) => type === 'lt.lens-blur'))
      .toBeLessThan(appended.findIndex(({ type }) => type === 'lt.grain'));
  });

  it('does not execute hidden Lens FX control layers', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const lensFx = selectAdjustmentLayerModules(base, 'lens-fx');
    const layer = { ...createAdjustmentLayer(lensFx, 'Lens Fx', 'lens-fx'), visible: false };
    const document = createImageDocument('Test', 32, 32, 'asset');
    document.layers.push(layer);

    const composed = composeDocumentFinalEffectStack(base, document);
    expect(composed.modules).toHaveLength(base.modules.length);
  });

  it('leaves composited Lens FX layers to the local renderer', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const lensFx = selectAdjustmentLayerModules(base, 'lens-fx');
    const layer = createAdjustmentLayer(lensFx, 'Lens Fx', 'lens-fx');
    layer.opacity = 0.5;
    const document = createImageDocument('Test', 32, 32, 'asset');
    document.layers.push(layer);

    expect(adjustmentLayerOwnsDocumentFinalEffects(layer)).toBe(true);
    expect(adjustmentLayerUsesDocumentFinalEffects(layer)).toBe(false);
    expect(composeDocumentFinalEffectStack(base, document).modules).toHaveLength(base.modules.length);
  });
});
