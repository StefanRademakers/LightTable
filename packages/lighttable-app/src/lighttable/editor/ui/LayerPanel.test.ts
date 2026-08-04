import { describe, expect, it } from 'vitest';
import { LAYER_CREATION_OPTIONS } from './LayerPanel';

describe('LayerPanel creation flyout', () => {
  it('orders processing and fill layers vertically and uses the gradient tool icon', () => {
    expect(LAYER_CREATION_OPTIONS).toEqual([
      { id: 'grade', label: 'New Grade layer', iconName: 'add_adjustment_layer.png' },
      { id: 'lens-fx', label: 'New Lens Fx layer', iconName: 'lens_fx.png' },
      { id: 'gradient-fill', label: 'New Gradient Fill layer', iconName: 'tool_gradient.png' }
    ]);
  });
});
