import { describe, expect, it } from 'vitest';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  type RasterLayer
} from '../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../processing/adjustmentStack';
import { createDefaultAdjustments } from '../types';
import { collectAdjustmentLayerIds } from './adjustmentLayerGpuResources';

describe('collectAdjustmentLayerIds', () => {
  it('finds explicit Grade Layers and raster layers with a local grade', () => {
    const background = createImageDocument('Image', 1, 1, 'asset').layers[0] as RasterLayer;
    const localGrade = {
      ...(createImageDocument('Local', 1, 1, 'local').layers[0] as RasterLayer),
      adjustmentStack: createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    };
    const gradeA = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade A'
    );
    const gradeB = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade B'
    );
    const nested = { ...createGroupLayer('Nested'), children: [gradeB] };
    const group = { ...createGroupLayer('Group'), children: [gradeA, nested] };
    const nodes = [background, localGrade, group];

    expect([...collectAdjustmentLayerIds(nodes)]).toEqual([
      localGrade.id,
      gradeA.id,
      gradeB.id
    ]);
  });

  it('drops owners whose grade modules are all disabled', () => {
    const grade = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Disabled grade'
    );
    grade.adjustmentStack.modules.forEach((module) => { module.enabled = false; });

    expect([...collectAdjustmentLayerIds([grade])]).toEqual([]);
  });
});
