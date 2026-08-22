import { describe, expect, it, vi } from 'vitest';
import { formatRenderTelemetry, RenderTelemetry } from './renderTelemetry';

describe('RenderTelemetry', () => {
  it('counts stage work and preserves the operation result', () => {
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12.5);
    const telemetry = new RenderTelemetry();
    telemetry.recordRenderCall();
    telemetry.recordCorrectionFrame();
    telemetry.recordScopePasses(1, 3);

    expect(telemetry.measure('output', () => 'result')).toBe('result');
    const snapshot = telemetry.snapshot();
    expect(snapshot.stages.output).toEqual({
      executions: 1,
      totalEncodeMs: 2.5,
      lastEncodeMs: 2.5,
      maximumEncodeMs: 2.5
    });
    expect(snapshot.scopeAnalysisPasses).toBe(1);
    expect(snapshot.scopeDisplayPasses).toBe(3);
    now.mockRestore();
  });

  it('formats reuse counts and resets without mutating old snapshots', () => {
    const telemetry = new RenderTelemetry();
    telemetry.recordRenderCall();
    telemetry.recordCorrectionFrame();
    telemetry.recordCorrectionFrame();
    telemetry.measure('display-post', () => undefined);
    const beforeReset = telemetry.snapshot();

    expect(formatRenderTelemetry(beforeReset)).toContain(
      'display-post: 1 executions; 1 correction-frame reuses'
    );
    expect(formatRenderTelemetry(beforeReset)).toContain('Scope analysis passes: 0');
    telemetry.reset();
    expect(telemetry.snapshot().correctionFrames).toBe(0);
    expect(telemetry.snapshot().scopeAnalysisPasses).toBe(0);
    expect(beforeReset.correctionFrames).toBe(2);
  });

  it('reports the selected and actually exercised vector backend', () => {
    const telemetry = new RenderTelemetry().snapshot();
    const report = formatRenderTelemetry({
      ...telemetry,
      vectorBackend: {
        selected: 'vello',
        active: 'mixed',
        velloFailure: null,
        velloSurfaces: 2,
        currentLayerEncodes: 3,
        velloLayerEncodes: 5,
        velloSceneRenders: 2,
        velloSceneCacheHits: 1,
        velloSceneEntries: 2,
        velloUploadedFragments: 3,
        velloUnsupportedLayerEncodes: 3,
        geometryCache: { entries: 1, bytes: 128, hits: 2, misses: 1, evictions: 0 }
      }
    });

    expect(report).toContain('Vector backend: selected vello; active mixed');
    expect(report).toContain('Vello scene renders 2');
    expect(report).toContain('unsupported fallbacks 3');
  });
});
