import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentInteractionCoordinator } from './AdjustmentInteractionCoordinator';
import type {
  AdjustmentInteractionToken,
  AdjustmentTransactionController
} from './useAdjustmentTransactionController';

const token = (sequence: number): AdjustmentInteractionToken => ({ sequence });

describe('AdjustmentInteractionCoordinator', () => {
  it('makes stale terminal callbacks from another control inert', () => {
    const first = token(1);
    const second = token(2);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      end: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const exposure = interactions.begin('exposure');
    const contrast = interactions.begin('contrast');
    interactions.end(exposure);
    interactions.change(contrast, (current) => ({ ...current, contrast: 12 }));
    interactions.end(contrast);

    expect(controller.cancel).toHaveBeenCalledWith(first);
    expect(controller.change).toHaveBeenCalledWith(expect.any(Function), 'grade', second);
    expect(controller.end).toHaveBeenCalledTimes(1);
    expect(controller.end).toHaveBeenCalledWith(second);
  });

  it('rejects stale changes after another control owns the transaction', () => {
    const first = token(1);
    const second = token(2);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      end: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const exposure = interactions.begin('exposure');
    const contrast = interactions.begin('contrast');

    expect(interactions.change(
      exposure,
      (current) => ({ ...current, exposureEV: 2 })
    )).toBe(false);
    expect(interactions.change(
      contrast,
      (current) => ({ ...current, contrast: 12 })
    )).toBe(true);
    expect(controller.change).toHaveBeenCalledTimes(1);
    expect(controller.change).toHaveBeenCalledWith(
      expect.any(Function),
      'grade',
      second
    );
  });

  it('does not turn a rejected gesture into discrete per-sample writes', () => {
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => null),
      end: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const rejected = interactions.begin('exposure');
    expect(rejected.token).toBeNull();
    expect(interactions.change(rejected, () => createDefaultAdjustments())).toBe(false);
    interactions.end(rejected);

    expect(controller.change).not.toHaveBeenCalled();
    expect(controller.reset).toHaveBeenCalledTimes(1);
  });

  it('ignores old end and cancel callbacks after the same control starts again', () => {
    const first = token(1);
    const second = token(2);
    const third = token(3);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second)
        .mockReturnValueOnce(third),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(), change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const oldEnd = interactions.begin('exposure');
    const currentAfterEnd = interactions.begin('exposure');
    interactions.end(oldEnd);
    interactions.change(currentAfterEnd, (value) => value);
    expect(controller.change).toHaveBeenLastCalledWith(
      expect.any(Function), 'grade', second
    );

    const oldCancel = currentAfterEnd;
    const currentAfterCancel = interactions.begin('exposure');
    interactions.cancel(oldCancel);
    interactions.end(currentAfterCancel);

    expect(controller.end).toHaveBeenCalledTimes(1);
    expect(controller.end).toHaveBeenCalledWith(third);
  });
});
