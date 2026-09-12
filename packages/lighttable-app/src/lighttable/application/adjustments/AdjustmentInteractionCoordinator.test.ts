import type { AdjustmentInteractionController as AdjustmentTransactionController } from './AdjustmentInteractionCoordinator';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentInteractionCoordinator as createCoordinator, type AdjustmentInteractionAdmission } from './AdjustmentInteractionCoordinator';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import type {
  AdjustmentInteractionToken
} from './useAdjustmentTransactionController';

const token = (sequence: number): AdjustmentInteractionToken => ({ sequence });

const createAdjustmentInteractionCoordinator = (controller: AdjustmentTransactionController,
  admission: AdjustmentInteractionAdmission = async () => ({ status: 'admitted' }),
  readIdentity: () => string = () => 'test-owner') => createCoordinator(controller, admission, () => {
    const identity = readIdentity(); return { isCurrent: () => identity === readIdentity() };
  }, error => { throw error; });

describe('AdjustmentInteractionCoordinator', () => {
  it('a superseded pending gesture cannot block the replacement gesture file commit', async () => {
    let first!: () => void; let second!: () => void;
    const waits = [new Promise<void>(resolve => { first = resolve; }), new Promise<void>(resolve => { second = resolve; })];
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    const interactions = createCoordinator(controller, async () => { await waits.shift(); return { status: 'admitted' }; },
      () => ({ isCurrent: () => true }), vi.fn());
    interactions.begin('old');
    const replacement = interactions.begin('replacement');
    interactions.change(replacement, value => ({ ...value, exposureEV: 2 }));
    const prepared = interactions.finishForFile();
    second(); await prepared; // Old admission is deliberately still unresolved.
    expect(controller.changeResult).toHaveBeenCalledOnce();
    expect(controller.end).toHaveBeenCalledOnce();
    first(); await Promise.resolve();
    expect(controller.changeResult).toHaveBeenCalledOnce();
  });

  it.each(['reset', 'owner'] as const)('a fresh file request ignores old pending %s deliveries', async retirement => {
    let resolve!: () => void; let identity = 'old';
    const wait = new Promise<void>(done => { resolve = done; });
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    const interactions = createCoordinator(controller, async () => { await wait; return { status: 'admitted' }; },
      () => { const opening = identity; return { isCurrent: () => opening === identity }; }, vi.fn());
    interactions.discreteChange(value => ({ ...value, exposureEV: 2 }));
    interactions.begin('old');
    if (retirement === 'reset') interactions.reset(); else identity = 'new';
    await interactions.finishForFile(); // No dependency on the retired admission.
    expect(controller.changeResult).not.toHaveBeenCalled();
    resolve(); await Promise.resolve(); await Promise.resolve();
    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it.each(['active', 'ended', 'discrete'] as const)('file completion awaits %s admission and canonical delivery', async mode => {
    let admit!: () => void;
    const admission = new Promise<void>(resolve => { admit = resolve; });
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    const interactions = createCoordinator(controller, async () => { await admission; return { status: 'admitted' }; },
      () => ({ isCurrent: () => true }), vi.fn());
    if (mode === 'discrete') interactions.discreteChange(value => ({ ...value, exposureEV: 2 }));
    else {
      const handle = interactions.begin('exposure');
      interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
      if (mode === 'ended') interactions.end(handle);
    }
    let complete = false;
    const prepared = interactions.finishForFile().then(() => { complete = true; });
    await Promise.resolve(); expect(complete).toBe(false);
    expect(controller.changeResult).not.toHaveBeenCalled();
    admit(); await prepared;
    expect(controller.changeResult).toHaveBeenCalledOnce();
    if (mode !== 'discrete') expect(controller.end).toHaveBeenCalledExactlyOnceWith(token(1));
    expect(controller.cancel).not.toHaveBeenCalled(); expect(controller.reset).not.toHaveBeenCalled();
  });

  it.each(['retirement', 'reset', 'rejection', 'failure'] as const)('file completion rejects pending %s', async mode => {
    let admit!: () => void; let current = true;
    const admission = new Promise<void>(resolve => { admit = resolve; });
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    if (mode === 'failure') controller.changeResult.mockImplementation(() => { throw new Error('GPU failed'); });
    const report = vi.fn();
    const interactions = createCoordinator(controller, async () => {
      await admission;
      return mode === 'rejection' ? { status: 'rejected', reason: 'Cannot settle' } : { status: 'admitted' };
    }, () => ({ isCurrent: () => current }), report);
    const handle = interactions.begin('exposure');
    interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
    const prepared = expect(interactions.finishForFile()).rejects.toThrow();
    if (mode === 'retirement') current = false;
    if (mode === 'reset') interactions.reset();
    admit(); await prepared;
    if (mode !== 'failure') expect(controller.changeResult).not.toHaveBeenCalled();
    else expect(report).toHaveBeenCalledOnce();
  });

  it('file completion preserves synchronous warm end and is a no-op without an owner or pending edit', async () => {
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    const interactions = createCoordinator(controller, async () => ({ status: 'admitted' }),
      () => ({ isCurrent: () => true }), vi.fn());
    const handle = interactions.begin('exposure'); await Promise.resolve();
    interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
    const prepared = interactions.finishForFile();
    expect(controller.end).toHaveBeenCalledOnce(); await prepared;
    await createCoordinator(controller, async () => ({ status: 'admitted' }), () => null, vi.fn()).finishForFile();
    expect(controller.end).toHaveBeenCalledOnce();
  });

  it.each(['changeResult', 'end'] as const)('retires its acquired token and reports a queued %s failure', async method => {
    const failure = new Error('delivery failed');
    const controller = { active: false, begin: vi.fn(() => token(7)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    controller[method].mockImplementation(() => { throw failure; });
    const report = vi.fn();
    const interactions = createCoordinator(controller, async () => ({ status: 'admitted' }),
      () => ({ isCurrent: () => true }), report);
    const handle = interactions.begin('exposure');
    interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
    interactions.end(handle);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.cancel).toHaveBeenCalledExactlyOnceWith(token(7));
    expect(controller.reset).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it.each(['lifecycle', 'renderer', 'workspace', 'generation'] as const)(
    'rejects pending samples when exact %s changes, even if target identity is unchanged', async field => {
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const state = { lifecycle: {}, renderer: {}, workspace: 'document-a', generation: 1 };
      const controller = { active: false, begin: vi.fn(() => token(1)),
        end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
      const interactions = createCoordinator(controller,
        async () => { await wait; return { status: 'admitted' }; },
        () => captureInteractionScope({ getWorkspaceId: () => state.workspace,
          getLifecycleIdentity: () => state.lifecycle, getRenderer: () => state.renderer,
          getRendererGeneration: () => state.generation }), error => { throw error; });
      const handle = interactions.begin('exposure');
      interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
      interactions.end(handle);
      interactions.discreteChange(value => ({ ...value, contrast: 10 }));
      if (field === 'lifecycle' || field === 'renderer') state[field] = {};
      else if (field === 'workspace') state.workspace = 'document-b';
      else state.generation = 2;
      release(); await wait; await Promise.resolve();
      expect(controller.begin).not.toHaveBeenCalled();
      expect(controller.changeResult).not.toHaveBeenCalled();
    });

  it('reset invalidates already-ended and discrete admission without needing a retained handle', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const controller = { active: false, begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
    const interactions = createAdjustmentInteractionCoordinator(controller,
      async () => { await wait; return { status: 'admitted' }; });
    const handle = interactions.begin('exposure');
    interactions.change(handle, value => ({ ...value, exposureEV: 2 }));
    interactions.end(handle);
    interactions.discreteChange(value => ({ ...value, contrast: 10 }));
    interactions.reset();
    release(); await wait; await Promise.resolve();
    expect(controller.begin).not.toHaveBeenCalled();
    expect(controller.changeResult).not.toHaveBeenCalled();
    expect(controller.reset).toHaveBeenCalledOnce();
    // A fresh interaction remains available after a Strict Mode reconnect.
    const fresh = interactions.begin('exposure');
    interactions.change(fresh, value => ({ ...value, exposureEV: 3 }));
    interactions.end(fresh);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.changeResult).toHaveBeenCalledOnce();
  });

  it('does not request admission without a canonical processing owner', () => {
    const controller = { active: false, begin: vi.fn(), end: vi.fn(() => 'committed' as const), cancel: vi.fn(),
      reset: vi.fn(), changeResult: vi.fn() };
    const admission = vi.fn(async () => ({ status: 'admitted' as const }));
    const interactions = createCoordinator(controller, admission, () => null, vi.fn());
    const handle = interactions.begin('exposure');
    expect(interactions.change(handle, value => value)).toBe(false);
    expect(interactions.discreteChange(value => value)).toBe(false);
    expect(admission).not.toHaveBeenCalled();
    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it('cancels only the opening token when owner retirement happens after admission', async () => {
    let current = true;
    const controller = { active: false, begin: vi.fn(() => token(1)), end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn() };
    const interactions = createCoordinator(controller, async () => ({ status: 'admitted' }),
      () => ({ isCurrent: () => current }), vi.fn());
    const handle = interactions.begin('exposure'); await Promise.resolve();
    current = false;
    expect(interactions.change(handle, value => value)).toBe(false);
    interactions.end(handle);
    expect(controller.cancel).toHaveBeenCalledWith(token(1));
    expect(controller.reset).not.toHaveBeenCalled();
    expect(controller.end).not.toHaveBeenCalled();
  });

  it('queues one adjustment gesture until an open pixel interaction has settled', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const admittedToken = token(1);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => admittedToken),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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
    expect(controller.changeResult).toHaveBeenCalledWith(
      expect.any(Function), 'grade', admittedToken
    );
    expect(controller.changeResult).toHaveBeenCalledOnce();
    const latestMutation = vi.mocked(controller.changeResult).mock.calls[0]?.[0];
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
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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
    expect(controller.changeResult).toHaveBeenCalledOnce();
    expect(controller.end).toHaveBeenCalledWith(admittedToken);
  });

  it('drops a queued gesture when its semantic target drifts during admission', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let ownerIntent = 'document-a:layer-a:grade:renderer-1';
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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
    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it('drops a queued discrete change when its semantic target drifts during admission', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let ownerIntent = 'document-a:layer-a:grade:renderer-1';
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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

    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it('does not admit or replay a queued adjustment after cancellation', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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
    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it('queues a discrete reset until mutation admission succeeds', async () => {
    let releaseAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
    };
    const interactions = createAdjustmentInteractionCoordinator(
      controller,
      () => admission.then(() => ({ status: 'admitted' as const }))
    );

    expect(interactions.discreteChange(() => createDefaultAdjustments())).toBe(true);
    expect(controller.changeResult).not.toHaveBeenCalled();
    releaseAdmission();
    await admission;
    await Promise.resolve();

    expect(controller.changeResult).toHaveBeenCalledOnce();
  });

  it('drops queued continuous and discrete mutations when admission is rejected', async () => {
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => token(1)),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
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
    expect(controller.changeResult).not.toHaveBeenCalled();
  });

  it('makes stale terminal callbacks from another control inert', async () => {
    const first = token(1);
    const second = token(2);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(),
      reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const exposure = interactions.begin('exposure');
    await Promise.resolve();
    const contrast = interactions.begin('contrast');
    await Promise.resolve();
    interactions.end(exposure);
    interactions.change(contrast, (current) => ({ ...current, contrast: 12 }));
    interactions.end(contrast);

    expect(controller.cancel).toHaveBeenCalledWith(first);
    expect(controller.changeResult).toHaveBeenCalledWith(expect.any(Function), 'grade', second);
    expect(controller.end).toHaveBeenCalledTimes(1);
    expect(controller.end).toHaveBeenCalledWith(second);
  });

  it('rejects stale changes after another control owns the transaction', async () => {
    const first = token(1);
    const second = token(2);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(),
      reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const exposure = interactions.begin('exposure');
    await Promise.resolve();
    const contrast = interactions.begin('contrast');
    await Promise.resolve();

    expect(interactions.change(
      exposure,
      (current) => ({ ...current, exposureEV: 2 })
    )).toBe(false);
    expect(interactions.change(
      contrast,
      (current) => ({ ...current, contrast: 12 })
    )).toBe(true);
    expect(controller.changeResult).toHaveBeenCalledTimes(1);
    expect(controller.changeResult).toHaveBeenCalledWith(
      expect.any(Function),
      'grade',
      second
    );
  });

  it('does not turn a rejected gesture into discrete per-sample writes', async () => {
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn(() => null),
      end: vi.fn(() => 'committed' as const),
      cancel: vi.fn(),
      reset: vi.fn(),
      changeResult: vi.fn(() => 'applied' as const)
    };
    const report = vi.fn();
    const interactions = createCoordinator(controller, async () => ({ status: 'admitted' }),
      () => ({ isCurrent: () => true }), report);

    const rejected = interactions.begin('exposure');
    await Promise.resolve();
    expect(rejected.token).toBeNull();
    expect(interactions.change(rejected, () => createDefaultAdjustments())).toBe(false);
    interactions.end(rejected);

    expect(controller.changeResult).not.toHaveBeenCalled();
    expect(controller.reset).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'The adjustment owner could not begin its pending edit.'
    }));
  });

  it('ignores old end and cancel callbacks after the same control starts again', async () => {
    const first = token(1);
    const second = token(2);
    const third = token(3);
    const controller: AdjustmentTransactionController = {
      active: false,
      begin: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second)
        .mockReturnValueOnce(third),
      end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const)
    };
    const interactions = createAdjustmentInteractionCoordinator(controller);

    const oldEnd = interactions.begin('exposure');
    await Promise.resolve();
    const currentAfterEnd = interactions.begin('exposure');
    await Promise.resolve();
    interactions.end(oldEnd);
    interactions.change(currentAfterEnd, (value) => value);
    expect(controller.changeResult).toHaveBeenLastCalledWith(
      expect.any(Function), 'grade', second
    );

    const oldCancel = currentAfterEnd;
    const currentAfterCancel = interactions.begin('exposure');
    await Promise.resolve();
    interactions.cancel(oldCancel);
    interactions.end(currentAfterCancel);

    expect(controller.end).toHaveBeenCalledTimes(1);
    expect(controller.end).toHaveBeenCalledWith(third);
  });
});
