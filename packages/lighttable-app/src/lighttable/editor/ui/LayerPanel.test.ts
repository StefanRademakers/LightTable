import { describe, expect, it } from 'vitest';
import type { LayerNode } from '../document/documentTypes';
import { LAYER_CREATION_OPTIONS, layerIsDocumentFx } from './LayerPanel';
import { localProcessingTreeItems } from './LocalProcessingTreeRows';
import { createAdjustmentLayer } from '../document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createDefaultAdjustments } from '../../types';

describe('LayerPanel creation flyout', () => {
  it('recognizes only Lens Fx adjustment layers as fixed document effects', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const lensFx = createAdjustmentLayer(
      selectAdjustmentLayerModules(base, 'lens-fx'), 'Lens Fx', 'lens-fx'
    );
    const grade = createAdjustmentLayer(
      selectAdjustmentLayerModules(base, 'grade'), 'Grade', 'grade'
    );

    expect(layerIsDocumentFx(lensFx)).toBe(true);
    expect(layerIsDocumentFx(grade)).toBe(false);
    lensFx.opacity = 0.5;
    expect(layerIsDocumentFx(lensFx)).toBe(false);
  });

  it('orders processing and fill layers vertically and uses the gradient tool icon', () => {
    expect(LAYER_CREATION_OPTIONS.map(({ id }) => id)).toEqual([
      'grade', 'lens-fx', 'brightness-contrast', 'levels', 'curves', 'exposure',
      'color-vibrance', 'hue-saturation', 'color-balance', 'black-white',
      'photo-filter', 'channel-mixer', 'color-lookup', 'invert', 'posterize',
      'threshold', 'gradient-map', 'selective-color', 'clarity-dehaze',
      'grain', 'gradient-fill'
    ]);
    expect(LAYER_CREATION_OPTIONS.filter(({ sectionStart }) => sectionStart).map(({ id }) => id))
      .toEqual(['brightness-contrast', 'color-vibrance', 'invert', 'clarity-dehaze', 'gradient-fill']);
    expect(LAYER_CREATION_OPTIONS.find(({ id }) => id === 'gradient-fill'))
      .toMatchObject({ iconName: 'tool_gradient.png' });
    expect(LAYER_CREATION_OPTIONS.find(({ id }) => id === 'curves'))
      .toMatchObject({ iconName: 'adjustment_curves.svg' });
  });

  it('projects a layer-local Grade as an expandable child instead of a status badge', () => {
    const raster = {
      type: 'raster',
      adjustmentStack: {
        id: 'local-processing',
        revision: 1,
        modules: [{
          id: 'light',
          type: 'lt.light',
          enabled: true,
          revision: 1,
          settings: {}
        }]
      }
    } as LayerNode;

    expect(localProcessingTreeItems(raster)).toEqual([
      { id: 'grade', label: 'Grade', enabled: true }
    ]);
  });

  it('projects layer-local Lens Fx as its own expandable child', () => {
    const raster = {
      type: 'raster',
      adjustmentStack: {
        id: 'local-processing',
        revision: 1,
        modules: [{
          id: 'lens-blur',
          type: 'lt.lens-blur',
          enabled: true,
          revision: 1,
          settings: {}
        }]
      }
    } as LayerNode;

    expect(localProcessingTreeItems(raster)).toEqual([
      { id: 'lens-fx', label: 'Lens Fx', enabled: true }
    ]);
  });

  it('projects an attached Curves node independently from local Grade', () => {
    const raster = {
      type: 'raster',
      adjustmentStack: {
        id: 'local-processing',
        revision: 1,
        modules: [{ id: 'curves', type: 'lt.curves', enabled: true, revision: 1, settings: {} }]
      }
    } as LayerNode;

    expect(localProcessingTreeItems(raster)).toEqual([
      { id: 'curves', label: 'Curves', enabled: true }
    ]);
  });
});
