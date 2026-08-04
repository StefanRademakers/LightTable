import { describe, expect, it } from 'vitest';
import { createImageDocument, type RasterLayer } from '../editor/document/documentTypes';
import type { AdjustmentStack } from '../processing/adjustmentStack';
import { WARP_NODE_TYPE, createDefaultWarpNodeSettings } from './warp/warpTypes';
import { LayerEffectRenderer, layerNeedsEffectRuntime } from './LayerEffectRenderer';

const layerWithStack = (stack: AdjustmentStack): RasterLayer => ({
  ...(createImageDocument('Effect owner', 32, 32, 'asset').layers[0] as RasterLayer),
  adjustmentStack: stack
});

describe('layerNeedsEffectRuntime', () => {
  it('retains a runtime for Warp geometry nodes', () => {
    const layer = layerWithStack({
      id: 'warp-stack',
      revision: 1,
      modules: [{
        id: 'warp-node',
        type: WARP_NODE_TYPE,
        enabled: true,
        revision: 1,
        settings: { ...createDefaultWarpNodeSettings() }
      }]
    });

    expect(layerNeedsEffectRuntime(layer)).toBe(true);
  });

  it('does not allocate an effect runtime for an empty stack', () => {
    expect(layerNeedsEffectRuntime(layerWithStack({
      id: 'empty-stack',
      revision: 0,
      modules: []
    }))).toBe(false);
  });
});

describe('LayerEffectRenderer memory telemetry', () => {
  it('reports zero before any per-owner runtime is realized', () => {
    const renderer = new LayerEffectRenderer(
      {} as GPUDevice,
      {} as GPUSampler,
      {} as GPUShaderModule
    );

    expect(renderer.estimatedTextureBytes()).toBe(0);
  });
});
