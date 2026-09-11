import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentInteractionCoordinator } from './AdjustmentInteractionCoordinator';
import type {
  AdjustmentInteractionToken,
  AdjustmentTransactionController
} from './useAdjustmentTransactionController';

const token = (sequence: number): AdjustmentInteractionToken => ({ sequence });

describe('AdjustmentInteractionCoordinator', () => {
  it('queues one adjustment gesture until an open pixel interaction has settled', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const admittedToken = token(1);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => admittedToken),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const }))
    );

    const exposure = interactions.begin('exposure');
    expect(interactions.change(
      exposure,
      (current) => ({ ...current, exposureEV: 1.25 })
    )).toBe(true);
    expect(interactions.change(
      exposure,
      (current) => ({ ...current, exposureEV: 2.5 })
    )).toBe(true);
    interactions.end(exposure);
    expect(controller.begin).not.toHaveBeenCalled();

    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.begin).toHaveBeenCalledOnce();
    expect(controller.change).toHaveBeenCalledWith(
      expect.any(Function), 'grade', admittedToken
    );
    expect(controller.change).toHaveBeenCalledOnce();
    const latestMutation = vi.mocked(controller.change).mock.calls[0]?.[0];
    expect(latestMutation?.(createDefaultAdjustments()).exposureEV).toBe(2.5);
    expect(controller.end).toHaveBeenCalledWith(admittedToken);
  });

  it('preserves the successor gesture when predecessor publication resets only the active controller', async () => {
    let releasePublication: () => void = () => undefined;
    const publication = new Promise<void>((resolve) => { releasePublication = resolve; });
    const admittedToken = token(1);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => admittedToken),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      async () => {
        await publication;
        // Transform publication may retire an adjustment preview that owned
        // the old document, but must not reset the coordinator lease waiting
        // to become the next owner.
        controller.reset();
        return { status: 'admitted' as const };
      },
      () => 'document-a:layer-a:grade:renderer-1'
    );

    const exposure = interactions.begin('exposure');
    interactions.change(exposure, (current) => ({ ...current, exposureEV: 3 }));
    interactions.end(exposure);
    releasePublication();
    await publication;
    await Promise.resolve();

    expect(controller.reset).toHaveBeenCalledOnce();
    expect(controller.begin).toHaveBeenCalledOnce();
    expect(controller.change).toHaveBeenCalledOnce();
    expect(controller.end).toHaveBeenCalledWith(admittedToken);
  });

  it('drops a queued gesture when its semantic target drifts during admission', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let ownerIntent = 'document-a:layer-a:grade:renderer-1';
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const })),
      () => ownerIntent
    );

    const exposure = interactions.begin('exposure');
    interactions.change(exposure, (current) => ({ ...current, exposureEV: 2 }));
    interactions.end(exposure);
    ownerIntent = 'document-a:layer-b:grade:renderer-1';
    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.begin).not.toHaveBeenCalled();
    expect(controller.change).not.toHaveBeenCalled();
  });

  it('drops a queued discrete change when its semantic target drifts during admission', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let ownerIntent = 'document-a:layer-a:grade:renderer-1';
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const })),
      () => ownerIntent
    );

    interactions.discreteChange((current) => ({ ...current, exposureEV: 2 }));
    ownerIntent = 'document-b:layer-a:grade:renderer-1';
    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.change).not.toHaveBeenCalled();
  });

  it('does not admit or replay a queued adjustment after cancellation', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const }))
    );
    const exposure = interactions.begin('exposure');
    interactions.change(exposure, (current) => ({ ...current, exposureEV: 2 }));
    interactions.cancel(exposure);

    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.begin).not.toHaveBeenCalled();
    expect(controller.change).not.toHaveBeenCalled();
  });

  it('queues a discrete reset until mutation admission succeeds', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const }))
    );

    expect(interactions.discreteChange(() => createDefaultAdjustments())).toBe(true);
    expect(controller.change).not.toHaveBeenCalled();
    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.change).toHaveBeenCalledOnce();
  });

  it('drops queued continuous and discrete mutations when admission is rejected', async () => {
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
      change: vi.fn(() => true)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      async () => ({ status: 'rejected', reason: 'settlement failed' })
    );
    const exposure = interactions.begin('exposure');
    interactions.change(exposure, (current) => ({ ...current, exposureEV: 2 }));
    interactions.end(exposure);
    interactions.discreteChange(() => createDefaultAdjustments());
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.begin).not.toHaveBeenCalled();
    expect(controller.change).not.toHaveBeenCalled();
  });

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
