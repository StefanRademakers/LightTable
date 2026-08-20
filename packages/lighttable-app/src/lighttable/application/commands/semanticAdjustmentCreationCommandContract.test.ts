import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createGroupLayer, createRasterLayer, setLayerLock } from '../../editor/document/documentCommands';
import {
  parseSemanticAdjustmentCreationCommand,
  resolveContextualAdjustmentCreation
} from './semanticAdjustmentCreationCommandContract';

describe('semantic adjustment creation contract', () => {
  it('parses explicit local, attached and adjustment-layer targets', () => {
    expect(parseSemanticAdjustmentCreationCommand({ kind: 'grade', placement: 'local', layerId: 'photo' }))
      .toEqual({ kind: 'grade', placement: 'local', layerId: 'photo' });
    expect(parseSemanticAdjustmentCreationCommand({ kind: 'threshold', placement: 'attached', layerId: 'photo' }))
      .toEqual({ kind: 'threshold', placement: 'attached', layerId: 'photo' });
    expect(parseSemanticAdjustmentCreationCommand({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: 'title' }))
      .toEqual({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: 'title' });
  });

  it.each([
    { kind: 'threshold', placement: 'local', layerId: 'photo' },
    { kind: 'hidden-kind', placement: 'attached', layerId: 'photo' },
    { kind: 'curves', placement: 'attached' },
    { kind: 'curves', placement: 'adjustment-layer', layerId: 'wrong-field' }
  ])('rejects invalid or ambiguous targets %#', (parameters) => {
    expect(parseSemanticAdjustmentCreationCommand(parameters)).toHaveProperty('message');
  });

  it('freezes the menu context into stable raster or layer targets', () => {
    const rasterDocument = createRasterLayer(createImageDocument('Raster', 80, 60, 'source'));
    const rasterId = rasterDocument.activeLayerId!;
    expect(resolveContextualAdjustmentCreation(rasterDocument, 'curves'))
      .toEqual({ kind: 'curves', placement: 'local', layerId: rasterId });
    expect(resolveContextualAdjustmentCreation(rasterDocument, 'threshold'))
      .toEqual({ kind: 'threshold', placement: 'attached', layerId: rasterId });
    const locked = setLayerLock(rasterDocument, rasterId, 'pixels', true);
    expect(resolveContextualAdjustmentCreation(locked, 'threshold'))
      .toEqual({ kind: 'threshold', placement: 'adjustment-layer', aboveLayerId: rasterId });

    const group = createGroupLayer(createImageDocument('Group', 80, 60, 'source'));
    expect(resolveContextualAdjustmentCreation(group, 'curves'))
      .toEqual({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: group.activeLayerId });
  });
});
