import { describe, expect, it } from 'vitest';
import { createAdjustmentLayer, createImageDocument, type RasterLayer } from '../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments, type AdjustmentStack } from '../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../processing/adjustmentLayerCatalog';
import { createDefaultAdjustments } from '../types';
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

  it('does not retain an effect runtime for disabled effect nodes', () => {
    const layer = layerWithStack({
      id: 'disabled-warp-stack',
      revision: 1,
      modules: [{
        id: 'disabled-warp-node',
        type: WARP_NODE_TYPE,
        enabled: false,
        revision: 1,
        settings: { ...createDefaultWarpNodeSettings() }
      }]
    });

    expect(layerNeedsEffectRuntime(layer)).toBe(false);
  });

  it('does not allocate a local runtime for a document-final Lens FX layer', () => {
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'lens-fx'
    );
    expect(layerNeedsEffectRuntime(createAdjustmentLayer(stack, 'Lens Fx', 'lens-fx')))
      .toBe(false);
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
