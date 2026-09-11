import { describe, expect, it, vi } from 'vitest';
import { publishBoundSelection } from './BoundSelectionPublication';

describe('publishBoundSelection', () => {
  it('revalidates after queue admission, before any live mutation', async () => {
    let current = true;
    const publish = vi.fn();
    await expect(publishBoundSelection({
      renderer: { publishTransformState: async (activate) => {
        await Promise.resolve();
        current = false;
        activate();
      } },
      bindingIsCurrent: () => current, publish
    })).rejects.toThrow('changed during restoration');
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not restore a target mask over the compound edit source mask', async () => {
    const order: string[] = [];
    await publishBoundSelection({
      renderer: { publishTransformState: async (activate) => {
        await Promise.resolve();
        order.push('admitted');
        activate();
        order.push('activated');
      } },
      bindingIsCurrent: () => true,
      publish: () => { order.push('pixels-mask-document'); }
    });
    expect(order).toEqual(['admitted', 'pixels-mask-document', 'activated']);
  });

  it('propagates publication failure without another asynchronous restoration', async () => {
    const failure = new Error('publication failed');
    await expect(publishBoundSelection({
      renderer: { publishTransformState: async (activate) => { activate(); } },
      bindingIsCurrent: () => true,
      publish: () => { throw failure; }
    })).rejects.toBe(failure);
  });
});
