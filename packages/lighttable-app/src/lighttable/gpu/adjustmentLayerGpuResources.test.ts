import { describe, expect, it } from 'vitest';
import type { LayerNode } from '../editor/document/documentTypes';
import { collectAdjustmentLayerIds } from './adjustmentLayerGpuResources';

describe('collectAdjustmentLayerIds', () => {
  it('finds adjustment layers at every group depth without including raster nodes', () => {
    const nodes = [
      { id: 'background', type: 'raster' },
      {
        id: 'group',
        type: 'group',
        children: [
          { id: 'grade-a', type: 'adjustment' },
          {
            id: 'nested',
            type: 'group',
            children: [{ id: 'grade-b', type: 'adjustment' }]
          }
        ]
      }
    ] as unknown as LayerNode[];

    expect([...collectAdjustmentLayerIds(nodes)]).toEqual(['grade-a', 'grade-b']);
  });
});
