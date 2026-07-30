import { describe, expect, it } from 'vitest';
import type { LayerNode } from '../editor/document/documentTypes';
import { collectAdjustmentLayerIds } from './adjustmentLayerGpuResources';

describe('collectAdjustmentLayerIds', () => {
  it('finds explicit Grade Layers and raster layers with a local grade', () => {
    const nodes = [
      { id: 'background', type: 'raster', adjustmentStack: null },
      { id: 'local-grade', type: 'raster', adjustmentStack: { modules: [] } },
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

    expect([...collectAdjustmentLayerIds(nodes)]).toEqual([
      'local-grade',
      'grade-a',
      'grade-b'
    ]);
  });
});
