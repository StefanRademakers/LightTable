import { describe, expect, it } from 'vitest';
import { PointerClickCounter } from './pointerClickCounter';

describe('PointerClickCounter', () => {
  it('counts bounded desktop multi-clicks even though PointerEvent.detail is unavailable', () => {
    const counter = new PointerClickCounter();
    const sample = (timeMs: number, x = 10) => ({
      x, y: 20, timeMs, button: 0, pointerType: 'mouse'
    });
    expect(counter.next(sample(100))).toBe(1);
    expect(counter.next(sample(180, 12))).toBe(2);
    expect(counter.next(sample(260, 11))).toBe(3);
    expect(counter.next(sample(340))).toBe(4);
    expect(counter.next(sample(420))).toBe(5);
    expect(counter.next(sample(500))).toBe(5);
    expect(counter.next(sample(1_100))).toBe(1);
    expect(counter.next(sample(1_200, 30))).toBe(1);
    counter.moved(60, 20);
    expect(counter.next(sample(1_250, 30))).toBe(1);
  });
});
