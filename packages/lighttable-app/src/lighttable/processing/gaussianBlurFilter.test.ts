import { describe, expect, it } from 'vitest';
import {
  createGaussianBlurStack,
  gaussianBlurSettings,
  setGaussianBlurRadius
} from './gaussianBlurFilter';

describe('Gaussian Blur filter model', () => {
  it('creates a stable canonical module and clamps authored radius', () => {
    let id = 0;
    const stack = createGaussianBlurStack(150, (kind) => `${kind}-${++id}`);
    expect(stack).toMatchObject({
      id: 'stack-1',
      modules: [{ id: 'module-2', type: 'lt.gaussian-blur', enabled: true }]
    });
    expect(gaussianBlurSettings(stack)).toEqual({ radius: 100 });
  });

  it('increments only filter revisions when radius changes', () => {
    const stack = createGaussianBlurStack(8, (kind) => kind);
    const next = setGaussianBlurRadius(stack, 12.5);
    expect(next.revision).toBe(stack.revision + 1);
    expect(next.modules[0]?.revision).toBe((stack.modules[0]?.revision ?? 0) + 1);
    expect(gaussianBlurSettings(next)).toEqual({ radius: 12.5 });
    expect(setGaussianBlurRadius(next, 12.5)).toBe(next);
  });
});
