import { describe, expect, it, vi } from 'vitest';
import { LensBlurDepthRequest, type LensBlurDepthRequestPorts } from './LensBlurDepthRequest';
import type { DepthAnalysisResult } from '../../../analysis/depth/types';
import { createDefaultAdjustments } from '../../../types';

const depth: DepthAnalysisResult = { width: 1, height: 1, data: new Float32Array([0.5]), nearIsOne: true };
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const setup = () => {
  let current = true; let sourceCurrent = true; let target = 'lens-a';
  const initialRenderer = { setDepthMap: vi.fn() };
  let renderer = initialRenderer;
  const analysis = deferred<DepthAnalysisResult>();
  const ports: LensBlurDepthRequestPorts = {
    captureScope: () => ({ isCurrent: () => current, assertCurrent: vi.fn() }),
    isSourceCurrent: () => sourceCurrent, getTargetIdentity: () => target,
    getRenderer: () => renderer, estimateDepth: vi.fn(() => analysis.promise),
    finishAdjustment: vi.fn(), settleInteraction: vi.fn(async () => {}),
    change: vi.fn(() => true), publishProgress: vi.fn(), publishResult: vi.fn()
  };
  const request = new LensBlurDepthRequest(ports);
  return { ports, request, analysis, initialRenderer,
    start: () => request.run(new Blob(['source']), 'source'),
    retire: () => { current = false; }, changeSource: () => { sourceCurrent = false; },
    changeTarget: () => { target = 'lens-b'; },
    replaceRenderer: () => { renderer = { setDepthMap: vi.fn() }; return renderer; }
  };
};

describe('LensBlurDepthRequest', () => {
  it('projects one successful result exactly once without creating an edit', async () => {
    const f = setup(); const running = f.start(); f.analysis.resolve(depth); await running;
    expect(f.initialRenderer.setDepthMap).toHaveBeenCalledExactlyOnceWith(depth);
    expect(f.ports.publishResult).toHaveBeenCalledExactlyOnceWith(depth);
    expect(f.ports.publishProgress).toHaveBeenLastCalledWith({ status: 'ready', message: 'Depth ready (1 x 1)' });
    expect(f.ports.change).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'retire', 'source', 'renderer'] as const)('rejects stale progress and completion after %s', async reason => {
    const f = setup(); const running = f.start();
    if (reason === 'cancel') f.request.cancel();
    if (reason === 'retire') f.retire();
    if (reason === 'source') f.changeSource();
    if (reason === 'renderer') f.replaceRenderer();
    vi.mocked(f.ports.estimateDepth).mock.calls[0][2]({ status: 'ready', message: 'stale' });
    f.analysis.resolve(depth); await running;
    expect(f.ports.publishProgress).toHaveBeenCalledOnce();
    expect(f.ports.publishResult).not.toHaveBeenCalled();
    expect(f.initialRenderer.setDepthMap).not.toHaveBeenCalled();
  });

  it('reset cancels a pending failure without disabling or reporting against another owner', async () => {
    const f = setup(); const running = f.start(); f.request.cancel();
    f.analysis.reject(new Error('Old error')); await running;
    expect(f.ports.publishProgress).toHaveBeenCalledOnce(); expect(f.ports.change).not.toHaveBeenCalled();
  });

  it('does not disable another target after inference or admission', async () => {
    const f = setup(); const admission = deferred<void>();
    vi.mocked(f.ports.settleInteraction).mockReturnValue(admission.promise);
    const running = f.start(); f.analysis.reject(new Error('Model failed'));
    await vi.waitFor(() => expect(f.ports.settleInteraction).toHaveBeenCalledOnce());
    f.changeTarget(); admission.resolve(); await running;
    expect(f.ports.change).not.toHaveBeenCalled();
    expect(f.ports.publishProgress).toHaveBeenLastCalledWith({ status: 'error', message: 'Model failed' });
  });

  it('reports a current analysis failure and disables only its originating Lens Blur', async () => {
    const f = setup(); const running = f.start(); f.analysis.reject(new Error('Model failed')); await running;
    expect(f.ports.change).toHaveBeenCalledOnce();
    const value = createDefaultAdjustments(); value.effects.lensBlur.enabled = true;
    expect(vi.mocked(f.ports.change).mock.calls[0][0](value).effects.lensBlur.enabled).toBe(false);
    expect(f.ports.publishProgress).toHaveBeenLastCalledWith({ status: 'error', message: 'Model failed' });
  });

  it('does not attribute a rejected retiring settlement to replacement-document presentation', async () => {
    const f = setup(); const admission = deferred<void>(); const report = vi.fn();
    vi.mocked(f.ports.settleInteraction).mockReturnValue(admission.promise);
    const running = f.start().catch(reason => { if (f.request.isCurrent()) report(reason); });
    f.analysis.reject(new Error('Analysis failed'));
    await vi.waitFor(() => expect(f.ports.settleInteraction).toHaveBeenCalledOnce());
    f.retire(); admission.reject(new Error('Retired document renderer'));
    await running; expect(report).not.toHaveBeenCalled(); expect(f.ports.change).not.toHaveBeenCalled();
  });

  it('still reports genuine current settlement failures', async () => {
    const f = setup(); const report = vi.fn();
    vi.mocked(f.ports.settleInteraction).mockRejectedValue(new Error('Commit failed'));
    const running = f.start().catch(reason => { if (f.request.isCurrent()) report(reason); });
    f.analysis.reject(new Error('Analysis failed')); await running;
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'Commit failed' }));
  });

  it('keeps projection failures observable and does not disguise them as inference or disable edits', async () => {
    const f = setup(); f.initialRenderer.setDepthMap.mockImplementation(() => { throw new Error('GPU failed'); });
    const running = f.start(); f.analysis.resolve(depth);
    await expect(running).rejects.toThrow('GPU failed'); expect(f.ports.change).not.toHaveBeenCalled();
    expect(f.ports.publishResult).not.toHaveBeenCalled();
  });

  it('a replacement subscription can use the same in-flight result without touching the retired renderer', async () => {
    const f = setup(); const old = f.start(); f.request.cancel();
    const replacement = f.replaceRenderer();
    const next = new LensBlurDepthRequest(f.ports).run(new Blob(['source']), 'source');
    f.analysis.resolve(depth); await Promise.all([old, next]);
    expect(f.initialRenderer.setDepthMap).not.toHaveBeenCalled();
    expect(replacement.setDepthMap).toHaveBeenCalledExactlyOnceWith(depth);
  });
});
