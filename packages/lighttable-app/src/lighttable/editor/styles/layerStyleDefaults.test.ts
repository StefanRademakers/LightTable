import { describe, expect, it } from 'vitest';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleStack,
  layerStyleStackIsActive
} from './layerStyleDefaults';
import { parseLayerStyleStack } from './layerStyleValidation';
import type { LayerStyleKind } from './layerStyleTypes';

const kinds: LayerStyleKind[] = [
  'drop-shadow',
  'inner-shadow',
  'outer-glow',
  'inner-glow',
  'bevel-emboss',
  'color-overlay',
  'gradient-overlay',
  'pattern-overlay',
  'satin',
  'stroke'
];

describe('LightTable Layer Style model', () => {
  it('creates and validates every Photoshop-compatible style family', () => {
    const stack = createDefaultLayerStyleStack();
    stack.effects = kinds.map(createDefaultLayerStyle);
    const parsed = parseLayerStyleStack(stack);
    expect(parsed.effects.map(({ kind }) => kind)).toEqual(kinds);
    expect(parsed).not.toBe(stack);
  });

  it('has an exact no-op empty or disabled path', () => {
    const stack = createDefaultLayerStyleStack();
    expect(layerStyleStackIsActive(stack)).toBe(false);
    stack.effects.push(createDefaultLayerStyle('drop-shadow'));
    expect(layerStyleStackIsActive(stack)).toBe(true);
    stack.enabled = false;
    expect(layerStyleStackIsActive(stack)).toBe(false);
  });

  it('rejects duplicate ids and malformed normalized colors', () => {
    const stack = createDefaultLayerStyleStack();
    const first = createDefaultLayerStyle('color-overlay');
    stack.effects = [first, structuredClone(first)];
    expect(() => parseLayerStyleStack(stack)).toThrow(/duplicate effect ids/);
    stack.effects = [first];
    if (first.kind === 'color-overlay') first.color.r = 2;
    expect(() => parseLayerStyleStack(stack)).toThrow(/invalid/);
  });
});
