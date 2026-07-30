import { describe, expect, it } from 'vitest';
import { RenderDirtyState } from './renderDirtyState';

describe('RenderDirtyState', () => {
  it('starts with every stage dirty for the first frame', () => {
    expect(new RenderDirtyState().snapshot()).toEqual({
      correction: true,
      blurInput: true,
      viewport: true,
      histogram: true
    });
  });

  it('keeps viewport changes isolated from image processing', () => {
    const state = cleanState();
    state.invalidate('viewport');
    expect(state.snapshot()).toEqual({
      correction: false,
      blurInput: false,
      viewport: true,
      histogram: false
    });
  });

  it('fans document and adjustment changes into correction, blur and scopes', () => {
    for (const reason of ['document', 'adjustments'] as const) {
      const state = cleanState();
      state.invalidate(reason);
      expect(state.snapshot()).toEqual({
        correction: true,
        blurInput: true,
        viewport: false,
        histogram: true
      });
    }
  });

  it('does not rebuild blur input for effect-only changes', () => {
    const state = cleanState();
    state.invalidate('effects');
    expect(state.snapshot()).toEqual({
      correction: true,
      blurInput: false,
      viewport: false,
      histogram: true
    });
  });

  it('invalidates the viewport after a corrected frame is produced', () => {
    const state = new RenderDirtyState();
    state.markViewportRendered();
    state.markCorrectionRendered();
    expect(state.correctionRequired).toBe(false);
    expect(state.viewportRequired).toBe(true);
  });
});

function cleanState() {
  const state = new RenderDirtyState();
  state.markBlurInputRendered();
  state.markCorrectionRendered();
  state.markViewportRendered();
  state.markHistogramScheduled();
  return state;
}
