import { describe, expect, it, vi } from 'vitest';
import { MountedInteractionLifecycle } from './MountedInteractionLifecycle';

describe('MountedInteractionLifecycle', () => {
  it('settles selection before transform and stops after retirement', async () => {
    const order: string[] = [];
    const owner = new MountedInteractionLifecycle({
      settleSelection: async () => { order.push('selection'); },
      settleTransform: async () => { order.push('transform'); },
      retireToolActivation: vi.fn(), retireTransitions: vi.fn(),
      retireSelection: vi.fn(), resetTransform: vi.fn()
    });

    await owner.settlePixels(() => false);
    expect(order).toEqual(['selection']);
  });

  it('retires tool admission before transition participants', () => {
    const order: string[] = [];
    const owner = new MountedInteractionLifecycle({
      settleSelection: vi.fn(), settleTransform: vi.fn(),
      retireToolActivation: () => { order.push('tool'); },
      retireTransitions: retire => { order.push('transition'); retire(); },
      retireSelection: () => { order.push('selection'); },
      resetTransform: () => { order.push('transform'); }
    });

    owner.retire();
    expect(order).toEqual(['tool', 'transition', 'selection', 'transform']);
  });
});
