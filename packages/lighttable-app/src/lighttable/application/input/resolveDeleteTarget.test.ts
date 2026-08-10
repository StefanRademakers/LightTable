import { describe, expect, it } from 'vitest';
import { resolveDeleteTarget } from './resolveDeleteTarget';

describe('resolveDeleteTarget', () => {
  it('prefers selected vector subobjects while a vector editing tool is active', () => {
    expect(resolveDeleteTarget({
      activeTool: 'vector-direct-select',
      hasVectorSelection: true,
      hasPixelSelection: true,
      hasActiveLayer: true
    })).toBe('vector-selection');
  });

  it('does not mistake retained vector state for Move/Transform tool intent', () => {
    expect(resolveDeleteTarget({
      activeTool: 'transform',
      hasVectorSelection: true,
      hasPixelSelection: false,
      hasActiveLayer: true
    })).toBe('layers');
  });

  it('clears selected pixels before considering layer deletion', () => {
    expect(resolveDeleteTarget({
      activeTool: 'brush',
      hasVectorSelection: false,
      hasPixelSelection: true,
      hasActiveLayer: true
    })).toBe('pixel-selection');
  });

  it('returns no target for an empty document', () => {
    expect(resolveDeleteTarget({
      activeTool: 'view',
      hasVectorSelection: false,
      hasPixelSelection: false,
      hasActiveLayer: false
    })).toBeNull();
  });
});
