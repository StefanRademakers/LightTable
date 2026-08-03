import { describe, expect, it, vi } from 'vitest';
import {
  TextEngineClient,
  describeTextWorkerError,
  type TextEngineWorkerPort
} from './TextEngineClient';
import { TEXT_ENGINE_PROTOCOL_VERSION } from './textEngineProtocol';
import {
  CONTRACT_FIXTURE_FONT_ASSET,
  CONTRACT_FIXTURE_FONT_INSTANCE,
  IDENTITY_MATRIX_3,
  TEXT_LAYOUT_SCHEMA_VERSION,
  TEXT_WORKER_PROTOCOL_VERSION,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  createTextLayoutCacheKey,
  type RealizedTextLayout
} from '@lighttable/text-core';

class FakeWorker implements TextEngineWorkerPort {
  onmessage: TextEngineWorkerPort['onmessage'] = null;
  onerror: TextEngineWorkerPort['onerror'] = null;
  onmessageerror: TextEngineWorkerPort['onmessageerror'] = null;
  readonly postMessage = vi.fn<TextEngineWorkerPort['postMessage']>();
  readonly terminate = vi.fn();

  ready(requestId: number) {
    this.onmessage?.({
      data: {
        kind: 'ready',
        protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
        requestId,
        engineVersion: '0.1.0',
        loadDurationMs: 4.5
      }
    } as MessageEvent);
  }

  inspected(requestId: number) {
    this.onmessage?.({
      data: {
        kind: 'font-inspected',
        protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
        requestId,
        glyphCount: 625,
        unitsPerEm: 1_000,
        axisCount: 2,
        outline: 'cff2',
        embeddingLevel: 'editable',
        noSubsetting: false,
        bitmapOnly: false
      }
    } as MessageEvent);
  }

  fontRegistered(requestId: number, revision: number) {
    this.onmessage?.({ data: {
      kind: 'font-registered', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId, documentSessionId: 'document', sessionGeneration: 1,
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId, fontSnapshotRevision: revision,
      metrics: { operationDurationMs: 2, wasmLinearMemoryBytes: 65_536 }
    } } as MessageEvent);
  }

  realized(requestId: number, cacheKey: string) {
    this.onmessage?.({ data: {
      kind: 'text-realized', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId, documentSessionId: 'document', sessionGeneration: 1,
      cacheKey, layout: realizedLayout(cacheKey), transferOwnership: 'dedicated',
      metrics: { operationDurationMs: 1.5, wasmLinearMemoryBytes: 5_636_096 }
    } } as MessageEvent);
  }

  released(requestId: number) {
    this.onmessage?.({ data: {
      kind: 'session-released', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId, documentSessionId: 'document', sessionGeneration: 1
    } } as MessageEvent);
  }

  rasterized(requestId: number, overrides: Partial<{
    assetId: string; faceIndex: number; glyphId: number; ppem: number; fontSnapshotRevision: number
  }> = {}) {
    this.onmessage?.({ data: {
      kind: 'glyph-rasterized', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId, documentSessionId: 'document', sessionGeneration: 1,
      assetId: overrides.assetId ?? CONTRACT_FIXTURE_FONT_ASSET.assetId,
      faceIndex: overrides.faceIndex ?? 0, glyphId: overrides.glyphId ?? 36,
      ppem: overrides.ppem ?? 24, fontSnapshotRevision: overrides.fontSnapshotRevision ?? 1,
      variationCoordinates: {}, syntheticBold: false, syntheticItalic: false,
      hinting: 'smooth', renderMode: 'alpha',
      transferOwnership: 'dedicated',
      raster: {
        width: 2, height: 2, bearingX: 0, bearingY: 2, commandCount: 4,
        pixels: new Uint8Array([0, 100, 200, 255])
      },
      metrics: { operationDurationMs: 0.75, wasmLinearMemoryBytes: 5_701_632 }
    } } as MessageEvent);
  }

  failed(requestId: number, message: string) {
    this.onmessage?.({ data: {
      kind: 'error',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId,
      message
    } } as MessageEvent);
  }
}

const realizedLayout = (key: string): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key,
  glyphRuns: [{
    font: CONTRACT_FIXTURE_FONT_INSTANCE,
    fontSize: 16,
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Inter'] } },
    paint: {}, renderingMode: 'invisible', direction: 'ltr',
    glyphIds: new Uint32Array([1]), clusters: new Uint32Array([0]),
    geometry: new Float32Array([0, 0, 8, 0])
  }],
  lines: [], caretStops: [], selectionGeometry: [],
  clusterMap: [{ textStart: 0, textEnd: 1, glyphStart: 0, glyphEnd: 1 }],
  inkBounds: { x: 0, y: 0, width: 8, height: 8 },
  logicalBounds: { x: 0, y: 0, width: 8, height: 10 }, warnings: []
});

const layoutRequest = () => {
  const source = createDefaultFlowTextSource('A');
  const layer = {
    ...createDefaultTextLayerData(),
    source: {
      ...source,
      styleRuns: [{
        ...source.styleRuns[0],
        requestedFont: {
          ...source.styleRuns[0].requestedFont,
          preferredAsset: CONTRACT_FIXTURE_FONT_ASSET
        }
      }]
    }
  };
  const options = { quality: 'final' as const, effectiveScale: 1, maxGlyphCount: 100 };
  const identity = {
    documentSessionId: 'document', sessionGeneration: 1, layerId: 'layer',
    revisions: layer.revisions, fontSnapshotRevision: 1,
    pathDependencyRevision: 0, options
  };
  return {
    kind: 'realize-text' as const,
    documentSessionId: identity.documentSessionId,
    sessionGeneration: identity.sessionGeneration,
    layerId: identity.layerId,
    layer,
    localToDocument: IDENTITY_MATRIX_3,
    fontSnapshotRevision: identity.fontSnapshotRevision,
    pathDependencyRevision: identity.pathDependencyRevision,
    cacheKey: createTextLayoutCacheKey(identity),
    options
  };
};

describe('TextEngineClient', () => {
  it('does not create a worker until the first explicit probe', () => {
    const factory = vi.fn(() => new FakeWorker());
    new TextEngineClient(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns a rejected promise when worker construction fails synchronously', async () => {
    const client = new TextEngineClient(() => {
      throw new Error('Worker blocked by CSP');
    });
    await expect(client.probe()).rejects.toThrow('Worker blocked by CSP');
  });

  it('deduplicates concurrent probes and reuses the successful capability', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const client = new TextEngineClient(factory);

    const first = client.probe();
    const second = client.probe();
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.ready(1);

    await expect(first).resolves.toEqual({ engineVersion: '0.1.0', loadDurationMs: 4.5 });
    await expect(client.probe()).resolves.toEqual({ engineVersion: '0.1.0', loadDurationMs: 4.5 });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('reports worker failures and can retry with a fresh worker', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const client = new TextEngineClient(factory);

    const failed = client.probe();
    firstWorker.onerror?.({ message: 'WASM failed' } as ErrorEvent);
    await expect(failed).rejects.toThrow('WASM failed');
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    const retried = client.probe();
    secondWorker.ready(2);
    await expect(retried).resolves.toMatchObject({ engineVersion: '0.1.0' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('times out an unresponsive startup and retries with a fresh worker', async () => {
    vi.useFakeTimers();
    try {
      const firstWorker = new FakeWorker();
      const secondWorker = new FakeWorker();
      const factory = vi.fn()
        .mockReturnValueOnce(firstWorker)
        .mockReturnValueOnce(secondWorker);
      const client = new TextEngineClient(factory, 25);

      const stalled = client.probe();
      const stalledExpectation = expect(stalled).rejects.toThrow(
        'did not respond within 25 milliseconds'
      );
      await vi.advanceTimersByTimeAsync(25);
      await stalledExpectation;
      expect(firstWorker.terminate).toHaveBeenCalledOnce();

      const retry = client.probe();
      secondWorker.ready(2);
      await expect(retry).resolves.toMatchObject({ engineVersion: '0.1.0' });
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves module-worker error causes and source locations', () => {
    expect(describeTextWorkerError({
      message: '',
      error: new TypeError('Missing WASM export'),
      filename: 'textLayout.worker.js',
      lineno: 42,
      colno: 7
    } as ErrorEvent).message).toBe(
      'TypeError: Missing WASM export at textLayout.worker.js:42:7'
    );
  });

  it('transfers font bytes to the persistent worker and returns inspected metadata', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);

    const inspection = client.inspectFont(new Uint8Array([0, 1, 0, 0]), 2);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inspect-font', faceIndex: 2 }),
      [expect.any(ArrayBuffer)]
    );
    worker.inspected(1);

    await expect(inspection).resolves.toMatchObject({
      glyphCount: 625,
      outline: 'cff2',
      embeddingLevel: 'editable'
    });
  });

  it('times out stalled font inspection and retries with a fresh worker', async () => {
    vi.useFakeTimers();
    try {
      const firstWorker = new FakeWorker();
      const secondWorker = new FakeWorker();
      const factory = vi.fn()
        .mockReturnValueOnce(firstWorker)
        .mockReturnValueOnce(secondWorker);
      const client = new TextEngineClient(factory, 10_000, 25);

      const stalled = client.inspectFont(new Uint8Array([0, 1, 0, 0]), 0);
      const expectation = expect(stalled).rejects.toThrow(
        'font inspection request did not respond within 25 milliseconds'
      );
      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      expect(firstWorker.terminate).toHaveBeenCalledOnce();

      const retry = client.inspectFont(new Uint8Array([0, 1, 0, 0]), 0);
      secondWorker.inspected(2);
      await expect(retry).resolves.toMatchObject({ glyphCount: 625 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminates the worker and rejects pending probes on dispose', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const pending = client.probe();
    client.dispose();
    await expect(pending).rejects.toThrow('canceled');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('transfers production font registration and accepts the typed response', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const bytes = new Uint8Array([0, 1, 0, 0]);
    const pending = client.registerFont({
      kind: 'register-font', documentSessionId: 'document', sessionGeneration: 1,
      font: CONTRACT_FIXTURE_FONT_ASSET, fontSnapshotRevision: 1,
      bytes, byteSource: 'transferred', transferOwnership: 'dedicated'
    });

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'register-font', fontSnapshotRevision: 1 }),
      [bytes.buffer]
    );
    worker.fontRegistered(1, 1);
    await expect(pending).resolves.toBeUndefined();
  });

  it('times out a stalled layout operation with its exact phase and resets the worker', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const client = new TextEngineClient(() => worker, 10_000, 25);
      const stalled = client.registerFont({
        kind: 'register-font', documentSessionId: 'document', sessionGeneration: 1,
        font: CONTRACT_FIXTURE_FONT_ASSET, fontSnapshotRevision: 1,
        bytes: new Uint8Array([0, 1, 0, 0]), byteSource: 'transferred', transferOwnership: 'dedicated'
      });
      const expectation = expect(stalled).rejects.toThrow(
        "'register-font' request did not respond within 25 milliseconds"
      );
      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an aborted layout immediately and discards its late response', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const abort = new AbortController();
    const pending = client.realizeText(layoutRequest(), abort.signal);
    abort.abort();

    await expect(pending).rejects.toMatchObject({
      layoutError: { code: 'cancelled', fallback: 'none' }
    });
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cancel-text', targetRequestId: 1 })
    );

    const ignored: RealizedTextLayout = {
      schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
      key: layoutRequest().cacheKey,
      glyphRuns: [{
        font: CONTRACT_FIXTURE_FONT_INSTANCE,
        fontSize: 16,
        fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Inter'] } },
        paint: {}, renderingMode: 'invisible', direction: 'ltr',
        glyphIds: new Uint32Array(), clusters: new Uint32Array(), geometry: new Float32Array()
      }],
      lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
      inkBounds: { x: 0, y: 0, width: 0, height: 0 },
      logicalBounds: { x: 0, y: 0, width: 0, height: 0 }, warnings: []
    };
    worker.onmessage?.({ data: {
      kind: 'text-realized', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: 1, documentSessionId: 'document', sessionGeneration: 1,
      cacheKey: ignored.key, layout: ignored, transferOwnership: 'dedicated'
    } } as MessageEvent);
  });

  it('cleans up a layout whose transferable post fails and permits a retry', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException('Buffer could not be cloned', 'DataCloneError');
    });
    const client = new TextEngineClient(() => worker);

    await expect(client.realizeText(layoutRequest())).rejects.toThrow('Buffer could not be cloned');

    const retryRequest = layoutRequest();
    const retry = client.realizeText(retryRequest);
    worker.realized(2, retryRequest.cacheKey);
    await expect(retry).resolves.toMatchObject({ key: retryRequest.cacheKey });
  });

  it('rejects a layout when module bootstrap reports a generic worker error', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const client = new TextEngineClient(factory);

    const failed = client.realizeText(layoutRequest());
    firstWorker.failed(1, 'SyntaxError: text worker module could not load');
    await expect(failed).rejects.toThrow('text worker module could not load');
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    const request = layoutRequest();
    const retried = client.realizeText(request);
    secondWorker.realized(2, request.cacheKey);
    await expect(retried).resolves.toMatchObject({ key: request.cacheKey });
  });

  it('returns worker metrics and rejects a wrong cache identity without resetting the worker', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const request = layoutRequest();
    const detailed = client.realizeTextDetailed(request);
    worker.realized(1, request.cacheKey);
    await expect(detailed).resolves.toMatchObject({
      metrics: { operationDurationMs: 1.5, wasmLinearMemoryBytes: 5_636_096 },
      responseTransferBytes: 24
    });

    const stale = client.realizeText(layoutRequest());
    worker.realized(2, 'wrong-cache-key');
    await expect(stale).rejects.toThrow('cache identity is stale');
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('releases an exact session generation through the persistent worker', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const pending = client.releaseSession('document', 1);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'release-session' }), []);
    worker.released(1);
    await expect(pending).resolves.toBeUndefined();
  });

  it('returns a dedicated bounded glyph raster and performance metrics', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const pending = client.rasterizeGlyph({
      kind: 'rasterize-glyph', documentSessionId: 'document', sessionGeneration: 1,
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId, faceIndex: 0,
      glyphId: 36, ppem: 24, fontSnapshotRevision: 1,
      variationCoordinates: {}, syntheticBold: false, syntheticItalic: false,
      hinting: 'smooth', renderMode: 'alpha'
    });
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rasterize-glyph', glyphId: 36, ppem: 24 }), []
    );
    worker.rasterized(1);
    await expect(pending).resolves.toMatchObject({
      raster: { width: 2, height: 2, commandCount: 4 },
      responseTransferBytes: 4,
      metrics: { operationDurationMs: 0.75 }
    });
  });

  it('rejects a glyph raster whose exact font or raster identity is stale', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const pending = client.rasterizeGlyph({
      kind: 'rasterize-glyph', documentSessionId: 'document', sessionGeneration: 1,
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId, faceIndex: 0,
      glyphId: 36, ppem: 24, fontSnapshotRevision: 1,
      variationCoordinates: {}, syntheticBold: false, syntheticItalic: false,
      hinting: 'smooth', renderMode: 'alpha'
    });
    worker.rasterized(1, { glyphId: 37 });
    await expect(pending).rejects.toThrow('raster response identity is stale');
  });

  it('does not let a disposed probe clear a new in-flight retry', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const client = new TextEngineClient(factory);

    const disposed = client.probe();
    client.dispose();
    const retry = client.probe();
    await expect(disposed).rejects.toThrow('canceled');
    const concurrent = client.probe();
    expect(concurrent).toBe(retry);
    expect(secondWorker.postMessage).toHaveBeenCalledTimes(1);
    secondWorker.ready(2);
    await expect(retry).resolves.toMatchObject({ engineVersion: '0.1.0' });
  });
});
