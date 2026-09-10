import { describe, expect, it, vi } from 'vitest';
import { admitAnglePointerInteraction } from './AngleControl';

describe('AngleControl interaction admission', () => {
  it('fails closed before pointer capture or local display mutation', () => {
    const rejected = vi.fn(() => false as const);
    expect(admitAnglePointerInteraction(rejected)).toBeNull();
    expect(rejected).toHaveBeenCalledOnce();
  });

  it('preserves the exact opaque handle for an admitted gesture', () => {
    const handle = { status: 'admitted', sequence: 7 };
    expect(admitAnglePointerInteraction(() => handle)).toEqual({ handle });
  });
});
