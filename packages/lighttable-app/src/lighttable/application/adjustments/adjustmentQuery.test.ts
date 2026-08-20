import { describe, expect, it } from 'vitest';
import { createImageDocument, type RasterLayer } from '../../editor/document/documentTypes';
import { createAdjustmentLayer, createRasterLayer,
  setRasterLayerAdjustmentStack } from '../../editor/document/documentCommands';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { ADJUSTMENT_LAYER_DEFINITIONS, selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createPointColorSample } from '../../pointColor';
import { projectAdjustmentQuery } from './adjustmentQuery';

const ids = () => {
  let next = 0;
  return (kind: 'stack' | 'module') => `${kind}-${next += 1}`;
};

describe('projectAdjustmentQuery', () => {
  it('projects document Grade modules with enabled and default-valued state', () => {
    const document = createImageDocument('Grade', 64, 64, 'asset');
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 1.25;
    const result = projectAdjustmentQuery('document-1', document, adjustments, 9,
      { kind: 'document', owner: 'grade' });
    expect(result).toMatchObject({ status: 'completed', documentRevision: 9,
      targetRevision: 9, adjustmentKind: 'grade', stack: { truncated: false } });
    if (result.status !== 'completed') throw new Error('Expected adjustment query result.');
    expect(result.stack.modules.find(({ type }) => type === 'lt.light')).toMatchObject({
      enabled: true, valueState: 'non-default', parameters: expect.arrayContaining([expect.objectContaining({
        path: 'exposureEV', value: 1.25, defaultValue: 0, state: 'non-default'
      })])
    });
  });

  it('returns only the active Photoshop adjustment family fields', () => {
    const values = createDefaultAdjustments();
    values.photoshopAdjustment.kind = 'color-vibrance';
    values.photoshopAdjustment.colorVibranceTemperature = -60;
    const stack = createAdjustmentStackFromBasicAdjustments(values, undefined, ids());
    stack.modules.find(({ type }) => type === 'lt.photoshop-adjustment')!.settings.lutBytes =
      'renderer-only-payload-must-not-cross-query';
    const document = createAdjustmentLayer(createImageDocument('Color', 64, 64, 'asset'),
      stack, 'Color and Vibrance', undefined, 'color-vibrance');
    const result = projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 3,
      { kind: 'layer', layerId: document.activeLayerId! });
    if (result.status !== 'completed') throw new Error('Expected adjustment query result.');
    const parameter = result.stack.modules.find(({ type }) => type === 'lt.photoshop-adjustment')!
      .parameters[0]!;
    expect(parameter.value).toEqual({ kind: 'color-vibrance', colorVibranceTemperature: -60,
      colorVibranceTint: 0, colorVibranceVibrance: 0, colorVibranceSaturation: 0 });
    expect(JSON.stringify(parameter.value)).not.toContain('selectiveColorValues');
    expect(JSON.stringify(result)).not.toContain('renderer-only-payload');
  });

  it('bounds authored curve arrays and reports truncation', () => {
    const values = createDefaultAdjustments();
    values.curves.master = Array.from({ length: 500 }, (_, index) => ({
      x: index / 499, y: index / 499
    }));
    const stack = createAdjustmentStackFromBasicAdjustments(values, undefined, ids());
    const document = createAdjustmentLayer(createImageDocument('Curves', 64, 64, 'asset'),
      stack, 'Curves', undefined, 'curves');
    const result = projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 2,
      { kind: 'layer', layerId: document.activeLayerId! });
    if (result.status !== 'completed') throw new Error('Expected adjustment query result.');
    const parameter = result.stack.modules.find(({ type }) => type === 'lt.curves')!.parameters[0]!;
    expect(parameter.truncated).toBe(true);
    expect((parameter.value as { master: unknown[] }).master).toHaveLength(64);
  });

  it('resolves attached adjustments without exposing sibling processing', () => {
    let document = createRasterLayer(createImageDocument('Attached', 64, 64, 'asset'));
    const layerId = document.activeLayerId!;
    const values = createDefaultAdjustments();
    values.photoshopAdjustment.kind = 'selective-color';
    values.photoshopAdjustment.selectiveColorValues[2] = 25;
    const adjustmentStack = createAdjustmentStackFromBasicAdjustments(values, undefined, ids());
    document = { ...document, layers: document.layers.map((candidate) => candidate.id === layerId
      ? { ...(candidate as RasterLayer), attachedAdjustments: [{ id: 'selective-1',
        name: 'Selective Color', adjustmentKind: 'selective-color', enabled: true, revision: 7,
        adjustmentStack }] }
      : candidate) };
    const result = projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 11,
      { kind: 'attached', layerId, adjustmentId: 'selective-1' });
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ status: 'completed', documentRevision: 11,
      targetRevision: 7, adjustmentKind: 'selective-color' });
  });

  it('rejects unsupported owners instead of returning raw stack data', () => {
    let document = createRasterLayer(createImageDocument('Unsupported', 64, 64, 'asset'));
    const layerId = document.activeLayerId!;
    document = setRasterLayerAdjustmentStack(document, layerId,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments(), undefined, ids()));
    expect(projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 1,
      { kind: 'layer', layerId: 'missing' as never })).toMatchObject({
        status: 'rejected', code: 'target-not-found'
      });
  });

  it('keeps Point Color samples bounded while preserving known editable fields', () => {
    const values = createDefaultAdjustments();
    values.pointColor = { samples: Array.from({ length: 100 }, (_, index) => ({
      ...createPointColorSample(`sample-${index}`, 0.5, 0.2, 1), hueShift: index
    })) };
    const document = createAdjustmentLayer(createImageDocument('Point Color', 64, 64, 'asset'),
      createAdjustmentStackFromBasicAdjustments(values, undefined, ids()), 'Grade', undefined, 'grade');
    const result = projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 2,
      { kind: 'layer', layerId: document.activeLayerId! });
    if (result.status !== 'completed') throw new Error('Expected adjustment query result.');
    const pointColor = result.stack.modules.find(({ type }) => type === 'lt.color-mixer')!
      .parameters.find(({ path }) => path === 'pointColor')!;
    expect(pointColor.truncated).toBe(true);
    expect((pointColor.value as { samples: unknown[] }).samples).toHaveLength(8);
    expect(JSON.stringify(pointColor.value)).not.toContain('unknownField');
  });

  it.each(ADJUSTMENT_LAYER_DEFINITIONS)('covers catalog kind $id through its canonical modules',
    (definition) => {
      const values = createDefaultAdjustments();
      if (definition.photoshopKind) values.photoshopAdjustment.kind = definition.photoshopKind;
      const selected = selectAdjustmentLayerModules(
        createAdjustmentStackFromBasicAdjustments(values, undefined, ids()), definition.id
      );
      const document = createAdjustmentLayer(createImageDocument(definition.name, 16, 16, 'asset'),
        selected, definition.name, undefined, definition.id);
      const result = projectAdjustmentQuery('document-1', document, createDefaultAdjustments(), 1,
        { kind: 'layer', layerId: document.activeLayerId! });
      expect(result).toMatchObject({ status: 'completed', adjustmentKind: definition.id,
        stack: { totalModules: selected.modules.length, truncated: false } });
    });
});
