import { describe, expect, it } from 'vitest';
import { planWarpFieldUpdate } from './warpFieldUpdatePlan';

describe('planWarpFieldUpdate', () => {
  it('does nothing when the committed recipe is unchanged', () => {
    const packed = new Float32Array([1, 2, 3, 4, 5, 6, 7, 0]);
    const plan = planWarpFieldUpdate(packed, packed.slice());

    expect(plan.kind).toBe('none');
    expect(plan.upload).toHaveLength(0);
  });

  it('uploads only appended stamps', () => {
    const committed = new Float32Array([1, 2, 3, 4, 5, 6, 7, 0]);
    const desired = new Float32Array([
      ...committed,
      8, 9, 10, 11, 12, 13, 14, 0
    ]);
    const plan = planWarpFieldUpdate(committed, desired);

    expect(plan.kind).toBe('append');
    expect(Array.from(plan.upload)).toEqual([8, 9, 10, 11, 12, 13, 14, 0]);
  });

  it('rebuilds after undo or an edited historical stamp', () => {
    const committed = new Float32Array([
      1, 2, 3, 4, 5, 6, 7, 0,
      8, 9, 10, 11, 12, 13, 14, 0
    ]);

    expect(planWarpFieldUpdate(committed, committed.slice(0, 8)).kind).toBe('rebuild');

    const edited = committed.slice();
    edited[2] = 99;
    expect(planWarpFieldUpdate(committed, edited).kind).toBe('rebuild');
  });

  it('rebuilds the initial field, including an empty recipe reset', () => {
    expect(
      planWarpFieldUpdate(new Float32Array(), new Float32Array([1, 2, 3, 4, 5, 6, 7, 0])).kind
    ).toBe('rebuild');
    expect(
      planWarpFieldUpdate(new Float32Array([1, 2, 3, 4, 5, 6, 7, 0]), new Float32Array()).kind
    ).toBe('rebuild');
  });
});
