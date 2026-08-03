import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyle, createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import { layerStyleTreeEffects } from './layerStyleTreePresentation';

describe('layerStyleTreeEffects', () => {
  it('shows only enabled effects without discarding dormant descriptors', () => {
    const stack = createDefaultLayerStyleStack();
    const shadow = createDefaultLayerStyle('drop-shadow');
    const dormantStroke = createDefaultLayerStyle('stroke');
    dormantStroke.enabled = false;
    stack.effects = [shadow, dormantStroke];

    expect(layerStyleTreeEffects(stack)).toEqual([shadow]);
    expect(stack.effects).toEqual([shadow, dormantStroke]);
  });

  it('does not expose an expandable effect tree for dormant effects only', () => {
    const stack = createDefaultLayerStyleStack();
    const dormantGradient = createDefaultLayerStyle('gradient-overlay');
    dormantGradient.enabled = false;
    stack.effects = [dormantGradient];

    expect(layerStyleTreeEffects(stack)).toHaveLength(0);
  });
});
