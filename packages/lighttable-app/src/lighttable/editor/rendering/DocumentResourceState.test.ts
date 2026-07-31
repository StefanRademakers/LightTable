import { describe, expect, it } from 'vitest';
import { DocumentResourceState } from './DocumentResourceState';

describe('DocumentResourceState', () => {
  it('owns document dimensions without exposing mutable state', () => {
    const state = new DocumentResourceState();
    state.setDimensions(1920, 1080);

    const dimensions = state.dimensions();
    dimensions.width = 1;

    expect(state.dimensions()).toEqual({ width: 1920, height: 1080 });
  });

  it('invalidates captured asynchronous work by generation', () => {
    const state = new DocumentResourceState();
    const initialGeneration = state.generation();

    expect(state.isCurrent(initialGeneration)).toBe(true);
    expect(state.invalidate()).toBe(initialGeneration + 1);
    expect(state.isCurrent(initialGeneration)).toBe(false);
    expect(state.isCurrent(state.generation())).toBe(true);
  });
});
