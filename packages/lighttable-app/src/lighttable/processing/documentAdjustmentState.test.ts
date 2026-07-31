import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../types';
import { DocumentAdjustmentState } from './documentAdjustmentState';

describe('DocumentAdjustmentState', () => {
  it('materializes replacement basic adjustments through the canonical stack', () => {
    const state = new DocumentAdjustmentState();
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 1.25;

    expect(state.replaceBasic(adjustments)).toBe(true);
    adjustments.exposureEV = -4;

    expect(state.current.exposureEV).toBe(1.25);
    expect(state.stackSnapshot().modules.length).toBeGreaterThan(0);
  });

  it('rejects identical basic adjustment updates before reevaluating the stack', () => {
    const state = new DocumentAdjustmentState();
    const adjustments = createDefaultAdjustments();

    expect(state.replaceBasic(adjustments)).toBe(false);
    adjustments.exposureEV = 0.5;
    expect(state.replaceBasic(adjustments)).toBe(true);
    expect(state.replaceBasic(adjustments)).toBe(false);
  });

  it('does not expose its mutable stack through snapshots', () => {
    const state = new DocumentAdjustmentState();
    const snapshot = state.stackSnapshot();
    snapshot.modules[0]!.enabled = false;

    expect(state.stackSnapshot().modules[0]!.enabled).toBe(true);
  });

  it('clones an incoming stack before retaining it', () => {
    const state = new DocumentAdjustmentState();
    const stack = state.stackSnapshot();
    state.replaceStack(stack);
    stack.modules[0]!.enabled = false;

    expect(state.stackSnapshot().modules[0]!.enabled).toBe(true);
  });

  it('uses stack and module revisions as the replacement contract', () => {
    const state = new DocumentAdjustmentState();
    const stack = state.stackSnapshot();

    expect(state.replaceStack(structuredClone(stack))).toBe(false);
    stack.modules[0]!.revision += 1;
    expect(state.replaceStack(stack)).toBe(true);
  });
});
