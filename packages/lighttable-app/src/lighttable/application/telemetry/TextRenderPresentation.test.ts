import { describe, expect, it, vi } from 'vitest';
import { createInitialTextRenderPresentation, TextRenderPresentation } from './TextRenderPresentation';

const snapshot = (revision: number, traceMessage: string | null = null) => ({
  ...createInitialTextRenderPresentation(), publicationRevision: revision,
  traceRevision: revision, traceMessage
});
const fixture = () => {
  const callbacks: (() => void)[] = [];
  const request = vi.fn((callback: () => void) => callbacks.push(callback));
  const cancel = vi.fn();
  const trace = vi.fn();
  const owner = new TextRenderPresentation({ request, cancel });
  const disconnect = owner.connect(trace);
  const flush = () => callbacks.at(-1)!();
  return { owner, trace, disconnect, request, cancel, callbacks, flush };
};

describe('TextRenderPresentation', () => {
  it('starts with the complete existing waiting-document projection', () => {
    const value = createInitialTextRenderPresentation();
    expect(value).toEqual({
      publicationRevision: 0, readyLayerCount: 0, textureBytes: 0,
      mode: 'placeholder', rebuildingLayerCount: 0,
      cacheBudgetBytes: 268435456, cacheEvictions: 0,
      atlasLayerCount: 0, cachedLayerCount: 0, atlasEncodes: 0,
      sourceCacheHits: 0, sourceCacheMisses: 0,
      layoutCacheBytes: 0, layoutCacheBudgetBytes: 33554432,
      layoutCacheHits: 0, layoutCacheMisses: 0, layoutCacheEvictions: 0,
      atlasBytes: 0, atlasHits: 0, atlasMisses: 0, atlasEvictions: 0,
      sourceDecisionMeasurements: 0, lastSourceDecision: null,
      coordinatorActive: true, configuredFontCount: 0, visibleTextLayerCount: 0,
      preparationStage: 'waiting-document', preparationLayerId: null, lastPreparationError: null,
      traceRevision: 0, traceMessage: null, traceDetails: null,
      shapingOperations: 0, latestShapingRoundTripMs: 0, rasterizedGlyphs: 0,
      latestRasterRoundTripMs: 0, textCacheSubmissions: 0, textInputLatencySamples: 0,
      pendingTextInputs: 0, supersededTextInputs: 0, inputToSubmitP95Ms: 0,
      inputToSubmitMaxMs: 0, inputToGpuP95Ms: 0, inputToGpuMaxMs: 0
    });
    expect(createInitialTextRenderPresentation()).not.toBe(value);
  });

  it('coalesces a burst to one frame, one publication and only the final trace', () => {
    const f = fixture(), listener = vi.fn();
    f.owner.subscribe(listener);
    f.owner.receive(snapshot(10, 'first'), () => true);
    f.owner.receive(snapshot(20, 'second'), () => true);
    const latest = { ...snapshot(30, 'last'), loadedFontBytes: 123 };
    f.owner.receive(latest, () => true);
    expect(f.request).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    f.flush();
    expect(f.owner.getSnapshot()).toBe(latest);
    expect(listener).toHaveBeenCalledOnce();
    expect(f.trace).toHaveBeenCalledExactlyOnceWith('info', 'GPU text pipeline', 'last', undefined);
  });

  it('retains the exact source predicate through the deferred publication', () => {
    const f = fixture(); let current = true;
    const initial = f.owner.getSnapshot();
    f.owner.receive(snapshot(2, 'old source'), () => current);
    current = false;
    f.flush();
    expect(f.owner.getSnapshot()).toBe(initial);
    expect(f.trace).not.toHaveBeenCalled();
    f.owner.receive(snapshot(3), () => current);
    expect(f.request).toHaveBeenCalledOnce();
    f.owner.receive(snapshot(4), () => true); f.flush();
    expect(f.owner.getSnapshot().publicationRevision).toBe(4);
  });

  it('reset cancels an admitted frame without allowing its callback to consume successor work', () => {
    const f = fixture();
    f.owner.receive(snapshot(9, 'stale'), () => true);
    const oldFrame = f.callbacks[0]!;
    f.owner.reset();
    expect(f.cancel).toHaveBeenCalledWith(1);
    expect(f.owner.getSnapshot()).toEqual(createInitialTextRenderPresentation());
    // The new request can be constructed before beforeOpen resets its presentation.
    const deliverNewRequest = (value: ReturnType<typeof snapshot>) => f.owner.receive(value, () => true);
    f.owner.reset(); deliverNewRequest(snapshot(2, 'new'));
    oldFrame();
    expect(f.owner.getSnapshot().publicationRevision).toBe(0);
    f.flush();
    expect(f.owner.getSnapshot().publicationRevision).toBe(2);
    expect(f.trace).toHaveBeenCalledExactlyOnceWith('info', 'GPU text pipeline', 'new', undefined);
  });

  it('deduplicates the complete trace signature and preserves severity/details', () => {
    const f = fixture();
    const failed = { ...snapshot(1, 'failed'), preparationStage: 'failed' as const, traceDetails: 'details' };
    f.owner.receive(failed, () => true); f.flush();
    f.owner.receive({ ...failed, textureBytes: 50 }, () => true); f.flush();
    expect(f.trace).toHaveBeenCalledExactlyOnceWith('error', 'GPU text pipeline', 'failed', 'details');
    f.owner.receive({ ...failed, traceDetails: 'different' }, () => true); f.flush();
    expect(f.trace).toHaveBeenCalledTimes(2);
    f.owner.reset(); f.owner.receive(failed, () => true); f.flush();
    expect(f.trace).toHaveBeenCalledTimes(3);
    // The existing diagnostics log may independently deduplicate these delivered events.
  });

  it.each(['reset', 'retire', 'source'] as const)('suppresses the old trace when a subscriber causes %s', action => {
    const f = fixture(); let current = true;
    const unsubscribe = f.owner.subscribe(() => {
      unsubscribe();
      if (action === 'reset') f.owner.reset();
      if (action === 'retire') f.disconnect();
      if (action === 'source') current = false;
    });
    f.owner.receive(snapshot(1, 'old'), () => current); f.flush();
    expect(f.trace).not.toHaveBeenCalled();
  });

  it('retires pending work before replay and protects a successor connection from old cleanup', () => {
    const f = fixture(), successorTrace = vi.fn();
    f.owner.receive(snapshot(1, 'old'), () => true);
    const oldFrame = f.callbacks[0]!;
    f.disconnect();
    f.owner.receive(snapshot(2), () => true);
    expect(f.request).toHaveBeenCalledOnce();
    f.owner.connect(successorTrace);
    f.disconnect();
    f.owner.receive(snapshot(3, 'new'), () => true);
    oldFrame(); f.flush();
    expect(f.owner.getSnapshot().publicationRevision).toBe(3);
    expect(f.trace).not.toHaveBeenCalled();
    expect(successorTrace).toHaveBeenCalledOnce();
  });

  it('releases subscriptions and leaves renderer revision values unchanged', () => {
    const f = fixture(), listener = vi.fn();
    const unsubscribe = f.owner.subscribe(listener); unsubscribe();
    f.owner.receive(snapshot(900), () => true); f.flush();
    f.owner.receive(snapshot(2), () => true); f.flush();
    expect(listener).not.toHaveBeenCalled();
    expect(f.owner.getSnapshot().publicationRevision).toBe(2);
    expect(f.trace).not.toHaveBeenCalled();
  });
});
