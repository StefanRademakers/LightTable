import { describe, expect, it } from 'vitest';
import {
  RenderDirtyState,
  resolveAdjustmentInvalidationStage
} from './renderDirtyState';

describe('resolveAdjustmentInvalidationStage', () => {
  const unchanged = {
    effectStage: null,
    uniformChanged: false,
    curveChanged: false,
    outputChanged: false
  } as const;

  it('does not render for state changes with no visible GPU output', () => {
    expect(resolveAdjustmentInvalidationStage(unchanged)).toBeNull();
  });

  it.each([
    ['uniform', { ...unchanged, uniformChanged: true }],
    ['curve', { ...unchanged, curveChanged: true }]
  ])('starts %s changes at the document Grade stage', (_name, change) => {
    expect(resolveAdjustmentInvalidationStage(change)).toBe('source-geometry');
  });

  it('keeps output-only settings at the output stage', () => {
    expect(resolveAdjustmentInvalidationStage({ ...unchanged, outputChanged: true })).toBe('output');
  });

  it('preserves an earlier effect stage', () => {
    expect(resolveAdjustmentInvalidationStage({
      ...unchanged,
      effectStage: 'linear-spatial',
      uniformChanged: true
    })).toBe('source-geometry');
  });

  it('uses output before a later display-post effect', () => {
    expect(resolveAdjustmentInvalidationStage({
      ...unchanged,
      effectStage: 'display-post',
      curveChanged: true
    })).toBe('source-geometry');
  });

  it('renders an effect-only change from its own stage', () => {
    expect(resolveAdjustmentInvalidationStage({
      ...unchanged,
      effectStage: 'source-geometry'
    })).toBe('source-geometry');
  });
});

describe('RenderDirtyState', () => {
  it('starts with every stage dirty for the first frame', () => {
    expect(new RenderDirtyState().snapshot()).toEqual({
      documentComposite: true,
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
      documentComposite: false,
      correction: false,
      blurInput: false,
      viewport: true,
      histogram: false
    });
  });

  it('rebuilds the layer composite for document changes', () => {
    const state = cleanState();
    state.invalidate('document');
    expect(state.snapshot()).toEqual({
      documentComposite: true,
      correction: true,
      blurInput: true,
      viewport: false,
      histogram: true
    });
  });

  it('reuses the layer composite for global adjustment changes', () => {
    const state = cleanState();
    state.invalidate('adjustments');
    expect(state.snapshot()).toEqual({
      documentComposite: false,
      correction: true,
      blurInput: true,
      viewport: false,
      histogram: true
    });
  });

  it('does not rebuild blur input for effect-only changes', () => {
    const state = cleanState();
    state.invalidate('effects');
    expect(state.snapshot()).toEqual({
      documentComposite: false,
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

  it('tracks downstream correction dependencies without waking earlier stages', () => {
    const state = cleanState();
    state.invalidateCorrectionFrom('display-post');
    expect(state.correctionStageRequired('source-geometry')).toBe(false);
    expect(state.correctionStageRequired('linear-spatial')).toBe(false);
    expect(state.correctionStageRequired('output')).toBe(false);
    expect(state.correctionStageRequired('display-post')).toBe(true);

    state.invalidateCorrectionFrom('linear-spatial');
    expect(state.correctionStageRequired('source-geometry')).toBe(false);
    expect(state.correctionStageRequired('linear-spatial')).toBe(true);
    expect(state.correctionStageRequired('output')).toBe(true);
    expect(state.correctionStageRequired('display-post')).toBe(true);
  });

  it('only reports frame work for stages that can emit commands', () => {
    const state = cleanState();
    expect(state.hasPendingFrameWork).toBe(false);

    state.invalidate('viewport');
    expect(state.hasPendingFrameWork).toBe(true);
    state.markViewportRendered();
    expect(state.hasPendingFrameWork).toBe(false);
  });
});

function cleanState() {
  const state = new RenderDirtyState();
  state.markDocumentCompositeRendered();
  state.markBlurInputRendered();
  state.markCorrectionRendered();
  state.markViewportRendered();
  state.markHistogramScheduled();
  return state;
}
