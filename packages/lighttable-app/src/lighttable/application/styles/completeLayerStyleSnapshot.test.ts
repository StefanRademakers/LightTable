import { describe, expect, it } from 'vitest';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleStack
} from '../../editor/styles/layerStyleDefaults';
import {
  layerStyleSnapshot,
  materializeLayerStyleSnapshot,
  parseCompleteLayerStyleSnapshot
} from './completeLayerStyleSnapshot';
import { MAX_LAYER_STYLE_MAGNITUDE } from '../../editor/styles/layerStyleValidation';

describe('complete Layer Style snapshot codec', () => {
  it('round-trips all ten effect kinds without transporting internal revision', () => {
    const stack = createDefaultLayerStyleStack();
    stack.revision = 42;
    stack.effects = [
      'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'bevel-emboss',
      'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke'
    ].map((kind) => createDefaultLayerStyle(kind as never));
    const snapshot = layerStyleSnapshot(stack);

    expect(snapshot).not.toHaveProperty('revision');
    expect(parseCompleteLayerStyleSnapshot(snapshot)).toEqual(snapshot);
    expect(materializeLayerStyleSnapshot(snapshot, 43)).toEqual({ ...snapshot, revision: 43 });
  });

  it('rejects extras, duplicate ids and invalid canonical values', () => {
    const shadow = createDefaultLayerStyle('drop-shadow');
    if (shadow.kind !== 'drop-shadow') throw new Error('Expected a drop shadow fixture.');
    const base = { ...layerStyleSnapshot(createDefaultLayerStyleStack()), effects: [shadow] };
    expect(parseCompleteLayerStyleSnapshot({ ...base, preview: true })).toBeNull();
    expect(parseCompleteLayerStyleSnapshot({ ...base, effects: [shadow, shadow] })).toBeNull();
    expect(parseCompleteLayerStyleSnapshot({
      ...base, effects: [{ ...shadow, size: -1 }]
    })).toBeNull();
    const invalidColor = { ...shadow.color, profile: 'srgb' };
    expect(parseCompleteLayerStyleSnapshot({
      ...base, effects: [{ ...shadow, color: invalidColor }]
    })).toBeNull();
  });

  it('accepts the wider finite values already supported by persisted PSD state', () => {
    const shadow = createDefaultLayerStyle('drop-shadow');
    if (shadow.kind !== 'drop-shadow') throw new Error('Expected a drop shadow fixture.');
    const snapshot = layerStyleSnapshot(createDefaultLayerStyleStack());
    snapshot.globalLight.angle = -450;
    snapshot.effects = [{ ...shadow, angle: 725, distance: 10_000, size: 20_000 }];
    expect(parseCompleteLayerStyleSnapshot(snapshot)).toEqual(snapshot);
    snapshot.effects = [{ ...shadow, size: MAX_LAYER_STYLE_MAGNITUDE + 1 }];
    expect(parseCompleteLayerStyleSnapshot(snapshot)).toBeNull();
  });
});
