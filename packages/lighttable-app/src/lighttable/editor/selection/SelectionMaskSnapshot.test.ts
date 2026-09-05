import { describe, expect, it } from 'vitest';
import { SelectionMaskSnapshot } from './SelectionMaskSnapshot';

describe('SelectionMaskSnapshot', () => {
  it('keeps noisy half-float selection words lossless and isolated from its input', () => {
    const source = Uint16Array.from([0, 1, 2, 3, 4, 5]);
    const snapshot = SelectionMaskSnapshot.fromRaw(3, 2, source);
    source.fill(99);
    expect(snapshot.encoding).toBe('raw-r16float');
    expect([...snapshot.toRaw()]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('compresses uniform areas and restores runs longer than 65536 pixels', () => {
    const source = new Uint16Array(70_000);
    source.fill(0x3c00);
    const snapshot = SelectionMaskSnapshot.fromRaw(350, 200, source);
    expect(snapshot.encoding).toBe('rle-r16float');
    expect(snapshot.byteSize).toBeLessThan(source.byteLength);
    expect(snapshot.toRaw()).toEqual(source);
  });

  it('represents an inactive selection without allocating document pixels', () => {
    const snapshot = SelectionMaskSnapshot.inactive(3840, 2160);
    expect(snapshot.active).toBe(false);
    expect(snapshot.byteSize).toBe(32);
    expect(() => snapshot.toRaw()).toThrow(/inactive selection/i);
  });

  it('rejects malformed dimensions and payload lengths', () => {
    expect(() => SelectionMaskSnapshot.inactive(0, 10)).toThrow(RangeError);
    expect(() => SelectionMaskSnapshot.fromRaw(2, 2, new Uint16Array(3))).toThrow(RangeError);
  });
});
