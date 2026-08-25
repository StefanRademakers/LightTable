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
    expect(parseSemanticAdjustmentCreationCommand({
      kind: 'posterize', placement: 'adjustment-layer', settings: { posterizeLevels: 6 }
    })).toEqual({
      kind: 'posterize', placement: 'adjustment-layer', settings: { posterizeLevels: 6 }
    });
    expect(parseSemanticAdjustmentCreationCommand({
      kind: 'gradient-map', placement: 'attached', layerId: 'photo', settings: {
        colorStops: [
          { position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0.2 } },
          { position: 1, midpoint: 0.5, color: { r: 1, g: 0.8, b: 0.1 } }
        ],
        opacityStops: [
          { position: 0, midpoint: 0.5, opacity: 1 },
          { position: 1, midpoint: 0.5, opacity: 1 }
        ],
        dither: true
      }
    })).toMatchObject({
      kind: 'gradient-map', placement: 'attached', layerId: 'photo',
      settings: { dither: true }
    });
    expect(parseSemanticAdjustmentCreationCommand({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: 'title' }))
      .toEqual({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: 'title' });
    expect(parseSemanticAdjustmentCreationCommand({
      kind: 'gaussian-blur', placement: 'adjustment-layer', settings: { radius: 12.5 }
    })).toEqual({
      kind: 'gaussian-blur', placement: 'adjustment-layer', settings: { radius: 12.5 }
    });
    expect(parseSemanticAdjustmentCreationCommand({
      kind: 'gaussian-blur', placement: 'attached', layerId: 'photo', settings: { radius: 4 }
    })).toEqual({
      kind: 'gaussian-blur', placement: 'attached', layerId: 'photo', settings: { radius: 4 }
    });
    expect(parseSemanticAdjustmentCreationCommand({
      kind: 'high-pass', placement: 'attached', layerId: 'photo', settings: { radius: 16 }
    })).toEqual({
      kind: 'high-pass', placement: 'attached', layerId: 'photo', settings: { radius: 16 }
    });
  });

  it.each([
    { kind: 'threshold', placement: 'local', layerId: 'photo' },
    { kind: 'hidden-kind', placement: 'attached', layerId: 'photo' },
    { kind: 'curves', placement: 'attached' },
    { kind: 'curves', placement: 'adjustment-layer', layerId: 'wrong-field' },
    { kind: 'posterize', placement: 'attached', layerId: 'photo', settings: { posterizeLevels: 1 } },
    { kind: 'threshold', placement: 'attached', layerId: 'photo', settings: { posterizeLevels: 4 } },
    { kind: 'curves', placement: 'adjustment-layer', settings: { thresholdLevel: 128 } },
    { kind: 'gaussian-blur', placement: 'adjustment-layer', settings: { radius: 101 } },
    { kind: 'high-pass', placement: 'adjustment-layer', settings: { radius: 0 } },
    { kind: 'gradient-map', placement: 'adjustment-layer', settings: {
      colorStops: [{ position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0 } }],
      opacityStops: [{ position: 0, midpoint: 0.5, opacity: 1 }]
    } },
    { kind: 'gradient-map', placement: 'adjustment-layer', settings: {
      colorStops: Array.from({ length: 9 }, (_, index) => ({
        position: index / 8, midpoint: 0.5, color: { r: 0, g: 0, b: 0 }
      })),
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 1 },
        { position: 1, midpoint: 0.5, opacity: 1 }
      ]
    } }
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
    expect(resolveContextualAdjustmentCreation(rasterDocument, 'gaussian-blur'))
      .toEqual({ kind: 'gaussian-blur', placement: 'attached', layerId: rasterId });
    const locked = setLayerLock(rasterDocument, rasterId, 'pixels', true);
    expect(resolveContextualAdjustmentCreation(locked, 'threshold'))
      .toEqual({ kind: 'threshold', placement: 'adjustment-layer', aboveLayerId: rasterId });

    const group = createGroupLayer(createImageDocument('Group', 80, 60, 'source'));
    expect(resolveContextualAdjustmentCreation(group, 'curves'))
      .toEqual({ kind: 'curves', placement: 'adjustment-layer', aboveLayerId: group.activeLayerId });
  });
});
