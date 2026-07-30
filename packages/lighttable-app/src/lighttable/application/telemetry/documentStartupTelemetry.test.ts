import { describe, expect, it } from 'vitest';
import { DocumentStartupTelemetry } from './documentStartupTelemetry';

describe('DocumentStartupTelemetry', () => {
  it('measures one first frame and merges parallel startup stages', () => {
    let time = 100;
    const telemetry = new DocumentStartupTelemetry(() => time);

    telemetry.begin();
    telemetry.rendererReady(12);
    telemetry.sourceReady(20);
    telemetry.merge({ decodeAndUploadMs: 7 });
    time = 145;

    expect(telemetry.completeFirstFrame()).toEqual({
      webGpuMs: 12,
      downloadMs: 20,
      decodeAndUploadMs: 7,
      firstFrameMs: 45
    });
    expect(telemetry.completeFirstFrame()).toBeNull();
  });

  it('restarts cleanly for a replacement document generation', () => {
    let time = 10;
    const telemetry = new DocumentStartupTelemetry(() => time);
    telemetry.begin();
    telemetry.merge({ decodeAndUploadMs: 99 });

    time = 200;
    telemetry.begin();
    time = 225;

    expect(telemetry.completeFirstFrame()).toEqual({ firstFrameMs: 25 });
  });

  it('measures deferred scopes without losing prior stages', () => {
    let time = 10;
    const telemetry = new DocumentStartupTelemetry(() => time);
    telemetry.begin();
    telemetry.rendererReady(3);
    const scopeStart = telemetry.beginDeferredScopes();
    time = 18;

    expect(telemetry.completeDeferredScopes(scopeStart)).toEqual({
      webGpuMs: 3,
      scopesMs: 8
    });
  });
});
