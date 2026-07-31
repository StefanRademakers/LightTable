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

    expect(telemetry.measure('output', () => 'result')).toBe('result');
    const snapshot = telemetry.snapshot();
    expect(snapshot.stages.output).toEqual({
      executions: 1,
      totalEncodeMs: 2.5,
      lastEncodeMs: 2.5,
      maximumEncodeMs: 2.5
    });
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
    telemetry.reset();
    expect(telemetry.snapshot().correctionFrames).toBe(0);
    expect(beforeReset.correctionFrames).toBe(2);
  });
});
