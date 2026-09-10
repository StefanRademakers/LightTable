import { describe, expect, it, vi } from 'vitest';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import { publishBoundSelection } from './BoundSelectionPublication';

describe('publishBoundSelection', () => {
  it('never publishes onto a replacement renderer generation after await', async () => {
    const before = SelectionMaskSnapshot.inactive(8, 8);
    const after = SelectionMaskSnapshot.inactive(8, 8);
    let generation = 1;
    const publish = vi.fn();
    const renderer = {
      restoreSelectionSnapshot: vi.fn(async () => {
        generation = 2;
        return true;
      })
    };

    await expect(publishBoundSelection({
      renderer, beforeMask: before, afterMask: after,
      bindingIsCurrent: () => generation === 1,
      rendererIsAddressable: () => generation === 1,
      publish
    })).rejects.toThrow('changed during restoration');

    expect(publish).not.toHaveBeenCalled();
    expect(renderer.restoreSelectionSnapshot).toHaveBeenCalledTimes(1);
  });

  it('restores the admitted mask when canonical publication rejects its lease', async () => {
    const before = SelectionMaskSnapshot.inactive(8, 8);
    const after = SelectionMaskSnapshot.inactive(8, 8);
    const renderer = { restoreSelectionSnapshot: vi.fn(async () => true) };
    await expect(publishBoundSelection({
      renderer, beforeMask: before, afterMask: after,
      bindingIsCurrent: () => true,
      rendererIsAddressable: () => true,
      publish: () => { throw new Error('CAS rejected'); }
    })).rejects.toThrow('CAS rejected');
    expect(renderer.restoreSelectionSnapshot).toHaveBeenNthCalledWith(1, after);
    expect(renderer.restoreSelectionSnapshot).toHaveBeenNthCalledWith(2, before);
  });

  it('retains the applied mask when publication state is explicitly indeterminate', async () => {
    const before = SelectionMaskSnapshot.inactive(8, 8);
    const after = SelectionMaskSnapshot.inactive(8, 8);
    const failure = new Error('indeterminate');
    const renderer = { restoreSelectionSnapshot: vi.fn(async () => true) };

    await expect(publishBoundSelection({
      renderer, beforeMask: before, afterMask: after,
      bindingIsCurrent: () => true,
      rendererIsAddressable: () => true,
      restoreBeforeOnPublishError: (reason) => reason !== failure,
      publish: () => { throw failure; }
    })).rejects.toBe(failure);

    expect(renderer.restoreSelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.restoreSelectionSnapshot).toHaveBeenCalledWith(after);
  });
});
