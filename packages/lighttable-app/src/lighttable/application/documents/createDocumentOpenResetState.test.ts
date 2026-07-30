import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createDocumentOpenResetState } from './createDocumentOpenResetState';

describe('createDocumentOpenResetState', () => {
  it('creates isolated defaults for every document generation', () => {
    const first = createDocumentOpenResetState();
    const second = createDocumentOpenResetState();

    first.adjustments.exposureEV = 2;
    first.editorSession.brush.size = 320;
    first.scopeSettings.traceBrightness = 0.25;
    first.scopeVisibility.histogram = false;

    expect(second.adjustments.exposureEV).toBe(0);
    expect(second.editorSession.brush.size).not.toBe(320);
    expect(second.scopeSettings.traceBrightness).not.toBe(0.25);
    expect(second.scopeVisibility.histogram).toBe(true);
    expect(second.groupVisibility.light).toBe(true);
    expect(second.groupVisibility).not.toBe(first.groupVisibility);
  });

  it('clones recipe adjustments instead of retaining caller state', () => {
    const recipe = createDefaultAdjustments();
    recipe.exposureEV = 1.5;

    const state = createDocumentOpenResetState(recipe);
    state.adjustments.exposureEV = -2;

    expect(recipe.exposureEV).toBe(1.5);
  });
});
