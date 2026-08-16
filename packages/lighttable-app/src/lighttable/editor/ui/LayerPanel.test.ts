import { describe, expect, it } from 'vitest';
import type { LayerNode } from '../document/documentTypes';
import { LAYER_CREATION_OPTIONS } from './LayerPanel';
import { localProcessingTreeItems } from './LocalProcessingTreeRows';

describe('LayerPanel creation flyout', () => {
  it('orders processing and fill layers vertically and uses the gradient tool icon', () => {
    expect(LAYER_CREATION_OPTIONS).toEqual([
      { id: 'grade', label: 'New Grade layer', iconName: 'add_adjustment_layer.png' },
      { id: 'lens-fx', label: 'New Lens Fx layer', iconName: 'lens_fx.png' },
      { id: 'gradient-fill', label: 'New Gradient Fill layer', iconName: 'tool_gradient.png' }
    ]);
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
});
