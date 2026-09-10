import { describe, expect, it, vi } from 'vitest';
import { runAfterTextEditingTerminal } from './textDocumentTransition';

describe('runAfterTextEditingTerminal', () => {
  it('commits editing before activating the next document', () => {
    const order: string[] = [];
    const controller = {
      getSnapshot: () => ({ status: 'editing' as const }),
      finish: () => { order.push('commit-A'); return true; }
    };
    expect(runAfterTextEditingTerminal(controller as never, () => order.push('activate-B'))).toBe(true);
    expect(order).toEqual(['commit-A', 'activate-B']);
  });

  it('does not activate the next document when the text terminal fails', () => {
    const transition = vi.fn();
    const controller = {
      getSnapshot: () => ({ status: 'editing' as const }),
      finish: () => false
    };
    expect(runAfterTextEditingTerminal(controller as never, transition)).toBe(false);
    expect(transition).not.toHaveBeenCalled();
  });
});
