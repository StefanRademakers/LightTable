import { describe, expect, it } from 'vitest';
import {
  createAdjustmentLayer,
  setLayersLock,
  setRasterLayerAdjustmentStack
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { resolveBasicAdjustmentTarget } from './basicAdjustmentTarget';

describe('basic adjustment target resolver', () => {
  it('resolves document and raster-layer values from canonical owners', () => {
    const global = { ...createDefaultAdjustments(), exposureEV: 0.5 };
    const base = createImageDocument('Grade', 64, 64, 'grade');
    const layerId = base.activeLayerId!;
    const local = { ...createDefaultAdjustments(), contrast: 24 };
    const document = setRasterLayerAdjustmentStack(
      base,
      layerId,
      createAdjustmentStackFromBasicAdjustments(local)
    );

    expect(resolveBasicAdjustmentTarget(document, global, { kind: 'document' }))
      .toMatchObject({ targetLayerId: null, adjustments: { exposureEV: 0.5 } });
    expect(resolveBasicAdjustmentTarget(document, global, { kind: 'layer', layerId }))
      .toMatchObject({ targetLayerId: layerId, adjustments: { contrast: 24 } });
  });

  it('accepts Grade Layers and rejects specialized or locked owners', () => {
    const base = createImageDocument('Grade', 64, 64, 'grade');
    const grade = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments({
        ...createDefaultAdjustments(), vibrance: 20
      }),
      'Grade',
      base.activeLayerId!,
      'grade'
    );
    const gradeId = grade.activeLayerId!;
    expect(resolveBasicAdjustmentTarget(
      grade,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: gradeId }
    )).toMatchObject({ adjustments: { vibrance: 20 } });

    const specialized = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Brightness / Contrast',
      base.activeLayerId!,
      'brightness-contrast'
    );
    expect(resolveBasicAdjustmentTarget(
      specialized,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: specialized.activeLayerId! }
    )).toHaveProperty('message');

    const locked = setLayersLock(base, [base.activeLayerId!], 'pixels', true);
    expect(resolveBasicAdjustmentTarget(
      locked,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: locked.activeLayerId! }
    )).toHaveProperty('message');
    expect(resolveBasicAdjustmentTarget(
      locked,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: locked.activeLayerId! },
      { allowLocked: true }
    )).toMatchObject({ targetLayerId: locked.activeLayerId });
  });
});
