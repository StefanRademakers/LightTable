import { describe, expect, it } from 'vitest';
import { coalescedPointerSamples } from './coalescedPointerSamples';

describe('coalescedPointerSamples', () => {
  it('preserves high-rate samples in their host-provided order', () => {
    const samples = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const event = { x: 4, getCoalescedEvents: () => samples };
    expect(coalescedPointerSamples(event)).toBe(samples);
  });

  it('falls back to the dispatched event when the API is absent or empty', () => {
    const absent = { x: 4 };
    const empty = { x: 5, getCoalescedEvents: () => [] };
    expect(coalescedPointerSamples(absent)).toEqual([absent]);
    expect(coalescedPointerSamples<{ x: number }>(empty)).toEqual([empty]);
  });
});
