import type { LayerStyleInstance, LayerStyleStack } from '../styles/layerStyleTypes';

/**
 * Photoshop retains settings for disabled effects but does not list those
 * dormant descriptors as children in the Layers panel.
 */
export const layerStyleTreeEffects = (
  stack: LayerStyleStack
): readonly LayerStyleInstance[] => stack.effects.filter((effect) => effect.enabled);
