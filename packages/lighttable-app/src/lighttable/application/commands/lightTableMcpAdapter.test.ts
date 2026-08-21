import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedLightTableMcpAdapter,
  LIGHTTABLE_MCP_PROTOCOL_VERSION
} from './lightTableMcpAdapter';
import type { LightTableAutomationDriver } from './lightTableCommandService';

const token = '0123456789abcdef0123456789abcdef';

const createDriver = (): LightTableAutomationDriver => ({
  beginGesture: vi.fn(async () => ({ status: 'started' as const, gestureId: 'gesture-1', sampleCount: 1 })),
  updateGesture: vi.fn(async () => ({ status: 'updated' as const, gestureId: 'gesture-1', sampleCount: 2 })),
  finishGesture: vi.fn(async () => ({ status: 'completed' as const, gestureId: 'gesture-1', sampleCount: 2 })),
  cancelAllGestures: vi.fn(async () => 0),
  registerInputArtifact: vi.fn(),
  queryArtifact: vi.fn(() => null),
  resolveArtifact: vi.fn(() => null),
  listArtifacts: vi.fn(() => []),
  releaseArtifact: vi.fn(() => true),
  requestDocumentPreview: vi.fn(async () => ({
    status: 'rejected' as const, code: 'document-not-ready' as const,
    message: 'The preview document is not ready.'
  })),
  requestLayerPreview: vi.fn(async () => ({
    status: 'rejected' as const, code: 'document-not-ready' as const,
    message: 'The preview document is not ready.'
  })),
  requestLayerPalette: vi.fn(async () => ({ status: 'completed' as const })),
  queryTask: vi.fn(() => null),
  queryTaskEvents: vi.fn(() => ({ cursor: 0, events: [] })),
  queryPublicationEvents: vi.fn(() => ({ cursor: 0, latestCursor: 0,
    oldestCursor: 1, gap: false, hasMore: false, events: [] })),
  waitForPublicationEvents: vi.fn(async () => ({ cursor: 0, latestCursor: 0,
    oldestCursor: 1, gap: false, hasMore: false, events: [], timedOut: true })),
  queryWorkspace: vi.fn(() => ({ revision: 1, activeDocumentId: null, documents: [] })),
  queryDocument: vi.fn(() => null),
  queryLayers: vi.fn(() => null),
  queryLayerPage: vi.fn(() => ({ status: 'completed' as const, documentId: 'document-1',
    canonicalRevision: 1, total: 0, offset: 0, limit: 128, truncated: false,
    nextCursor: null, layers: [] })),
  queryLayerDetail: vi.fn(() => ({ status: 'rejected' as const,
    code: 'layer-not-found' as const, message: 'missing' })),
  queryLayerEffects: vi.fn(() => null),
  queryText: vi.fn(() => null),
  queryVector: vi.fn(() => null),
  queryWarp: vi.fn(() => null),
  queryBasicGrade: vi.fn(() => null),
  queryAdjustment: vi.fn(() => ({ status: 'rejected' as const,
    code: 'target-not-found' as const, message: 'missing' })),
  queryCapabilities: vi.fn(() => null),
  execute: vi.fn(async (request: unknown) => ({
    requestId: (request as { requestId: string }).requestId,
    status: 'completed' as const, value: {}, revisions: { workspace: 1 }
  }))
});

const request = (method: string, parameters: Record<string, unknown> = {}, suppliedToken = token) => ({
  protocolVersion: LIGHTTABLE_MCP_PROTOCOL_VERSION,
  requestId: `request-${method}`,
  token: suppliedToken,
  method,
  parameters
});

describe('AuthenticatedLightTableMcpAdapter', () => {
  it('is opt-in and authenticates short-lived capability tokens', async () => {
    const driver = createDriver();
    const disabled = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: false, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await disabled.invoke(request('workspace.query'))).toMatchObject({
      status: 'rejected', code: 'adapter-disabled'
    });
    const enabled = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await enabled.invoke(request('workspace.query', {}, 'wrong-token-value-that-is-long')))
      .toMatchObject({ status: 'rejected', code: 'authentication-failed' });
    expect(await enabled.invoke(request('workspace.query')))
      .toMatchObject({ status: 'completed', value: { revision: 1 } });
  });

  it('forwards revision-bound document preview requests without command mutation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    await adapter.invoke(request('document.preview', {
      documentId: 'document-1', expectedDocumentRevision: 7, maxEdge: 512
    }));
    expect(driver.requestDocumentPreview).toHaveBeenCalledWith({
      documentId: 'document-1', expectedDocumentRevision: 7, maxEdge: 512
    });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards isolated layer preview requests without command mutation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    const parameters = { documentId: 'document-1', layerId: 'layer-1', channel: 'mask',
      expectedDocumentRevision: 7, maxEdge: 512 };
    await adapter.invoke(request('layer.preview', parameters));
    expect(driver.requestLayerPreview).toHaveBeenCalledWith(parameters);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards isolated layer palette requests without command mutation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    const parameters = { documentId: 'document-1', layerId: 'layer-1',
      expectedDocumentRevision: 7, colorCount: 16 };
    await adapter.invoke(request('layer.palette', parameters));
    expect(driver.requestLayerPalette).toHaveBeenCalledWith(parameters);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards reconnect-safe publication event cursors as read-only state', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    await adapter.invoke(request('event.query', { afterCursor: 12, limit: 50 }));
    expect(driver.queryPublicationEvents).toHaveBeenCalledWith(12, 50);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('waits for reconnect-safe publication events without executing a command', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    await expect(adapter.invoke(request('event.wait', {
      afterCursor: 12, limit: 50, timeoutMs: 4_000
    }))).resolves.toMatchObject({ status: 'completed', value: { timedOut: true } });
    expect(driver.waitForPublicationEvents).toHaveBeenCalledWith(12, 50, 4_000);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards bounded layer-page revisions, cursors and limits', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    await adapter.invoke(request('layer.list', { documentId: 'document-1',
      expectedDocumentRevision: 7, cursor: 'cursor-1', limit: 32 }));
    expect(driver.queryLayerPage).toHaveBeenCalledWith({ documentId: 'document-1',
      expectedDocumentRevision: 7, cursor: 'cursor-1', limit: 32 });
    expect(driver.queryLayers).not.toHaveBeenCalled();
  });

  it('forwards active-layer detail inspection without command mutation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 7 };
    await adapter.invoke(request('layer.query', parameters));
    expect(driver.queryLayerDetail).toHaveBeenCalledWith(parameters);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('allows only the explicit command surface and supports revocation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'layer.rename', documentId: 'document-1',
      commandRequestId: 'rename-1', commandParameters: { layerId: 'layer-1', name: 'Renamed' }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'layer.rename' }),
      { origin: 'mcp', recording: 'record' }
    );
    expect(await adapter.invoke(request('command.execute', {
      command: 'document.duplicate', documentId: 'document-1',
      commandRequestId: 'duplicate-1', commandParameters: { name: 'Variant A' }
    }))).toMatchObject({ status: 'completed' });
    expect(await adapter.invoke(request('command.execute', { command: 'faceWarp.applyOperation' })))
      .toMatchObject({ status: 'rejected', code: 'command-not-allowed' });
    adapter.revoke();
    expect(await adapter.invoke(request('artifact.list')))
      .toMatchObject({ status: 'rejected', code: 'session-revoked' });
    expect(adapter.activity()).toHaveLength(4);
  });

  it('forwards semantic document creation and placement with optimistic revisions', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    await adapter.invoke(request('command.execute', {
      command: 'document.create', commandRequestId: 'create-1', expectedWorkspaceRevision: 4,
      commandParameters: { name: 'Agent canvas', width: 400, height: 300, resolutionPpi: 72,
        bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' } }
    }));
    await adapter.invoke(request('command.execute', {
      command: 'layer.placeArtifact', documentId: 'document-1', commandRequestId: 'place-1',
      expectedDocumentRevision: 2, commandParameters: { artifactId: 'artifact-1', x: 10, y: 20 }
    }));
    expect(driver.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'document.create', expectedWorkspaceRevision: 4
    }), { origin: 'mcp', recording: 'record' });
    expect(driver.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.placeArtifact', documentId: 'document-1', expectedDocumentRevision: 2
    }), { origin: 'mcp', recording: 'record' });
  });

  it('exposes bounded text queries and semantic text edits', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryText).mockReturnValue({ layerId: 'text-1' as never, sourceKind: 'flow',
      editable: true, revision: 1, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      content: { text: 'Hello', totalLength: 5, truncated: false }, layout: { mode: 'point' },
      styleRuns: [], paragraphRuns: [], runsTruncated: false });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('text.query', { documentId: 'document-1', layerId: 'text-1' })))
      .toMatchObject({ status: 'completed', value: { content: { text: 'Hello' } } });
    expect(await adapter.invoke(request('command.execute', { command: 'text.format',
      documentId: 'document-1', commandRequestId: 'format-1',
      commandParameters: { layerId: 'text-1', style: { fontSize: 72 } } })))
      .toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'text.format' }),
      { origin: 'mcp', recording: 'record' }
    );
  });

  it('exposes bounded vector queries and semantic vector/style edits', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryVector).mockReturnValue({ layerId: 'vector-1' as never, revision: 2,
      totalElements: 1, truncated: false, elements: [] });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('vector.query', { documentId: 'document-1', layerId: 'vector-1' })))
      .toMatchObject({ status: 'completed', value: { totalElements: 1 } });
    expect(await adapter.invoke(request('command.execute', { command: 'vector.create',
      documentId: 'document-1', commandRequestId: 'vector-create', commandParameters: {
        primitive: { kind: 'ellipse', x: 0, y: 0, width: 80, height: 40 }
      } }))).toMatchObject({ status: 'completed' });
    expect(await adapter.invoke(request('command.execute', { command: 'layer.effect.add',
      documentId: 'document-1', commandRequestId: 'effect-add', commandParameters: {
        layerId: 'vector-1', effectKind: 'stroke'
    } }))).toMatchObject({ status: 'completed' });
  });

  it('exposes bounded Warp queries and admitted semantic stroke execution', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryWarp!).mockReturnValue({
      layerId: 'raster-1' as never, revision: 3, enabled: true,
      totalStrokes: 1, totalSamples: 2, truncated: false,
      settings: { opacity: 1, borderMode: 'transparent', topologyMode: 'artistic',
        edgePinning: 0, maskLinkMode: 'linked' }, strokes: []
    });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('warp.query', {
      documentId: 'document-1', layerId: 'raster-1'
    }))).toMatchObject({ status: 'completed', value: { totalStrokes: 1, totalSamples: 2 } });
    expect(await adapter.invoke(request('command.execute', {
      command: 'warp.applyStroke', documentId: 'document-1',
      commandRequestId: 'warp-1', commandParameters: {}
    }))).toMatchObject({ status: 'completed' });
  });

  it('forwards admitted structural layer commands with stable targets and revisions', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'layer.setBlendMode', documentId: 'document-1',
      commandRequestId: 'blend-1', expectedDocumentRevision: 12,
      commandParameters: { layerId: 'layer-1', blendMode: 'multiply' }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'layer.setBlendMode', documentId: 'document-1',
      expectedDocumentRevision: 12,
      parameters: { layerId: 'layer-1', blendMode: 'multiply' }
    }), { origin: 'mcp', recording: 'record' });
  });

  it('forwards one final selection-state operation without pointer simulation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'selection.modify', documentId: 'document-1',
      commandRequestId: 'selection-invert-1', expectedDocumentRevision: 12,
      commandParameters: { kind: 'modify', operation: 'invert' }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'selection.modify', documentId: 'document-1',
      expectedDocumentRevision: 12,
      parameters: { kind: 'modify', operation: 'invert' }
    }), { origin: 'mcp', recording: 'record' });
  });

  it('forwards one final targeted Grade patch without slider simulation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'grade.setBasic', documentId: 'document-1',
      commandRequestId: 'grade-basic-1', expectedDocumentRevision: 12,
      commandParameters: {
        target: { kind: 'layer', layerId: 'photo' },
        values: { exposureEV: 0.4, contrast: 12 }
      }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'grade.setBasic', documentId: 'document-1',
      expectedDocumentRevision: 12,
      parameters: {
        target: { kind: 'layer', layerId: 'photo' },
        values: { exposureEV: 0.4, contrast: 12 }
      }
    }), { origin: 'mcp', recording: 'record' });
  });

  it('forwards an authenticated read-only basic Grade query', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryBasicGrade).mockReturnValue({
      target: { kind: 'document' }, documentRevision: 4, targetRevision: 4,
      values: { temperature: -12, tint: 3, exposureEV: 0.5, contrast: 8,
        highlights: 0, shadows: 0, whites: 0, blacks: 0, lift: 0,
        texture: 0, clarity: 0, dehaze: 0, vibrance: 20, saturation: 0 }
    });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('grade.queryBasic', {
      documentId: 'document-1', target: { kind: 'document' }
    }))).toMatchObject({ status: 'completed', value: {
      documentRevision: 4, values: { exposureEV: 0.5, vibrance: 20 }
    } });
    expect(driver.queryBasicGrade).toHaveBeenCalledWith(
      'document-1', { kind: 'document' }
    );
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards bounded adjustment inspection without command execution', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryAdjustment).mockReturnValue({ status: 'completed',
      documentId: 'document-1', documentRevision: 4, targetRevision: 4,
      target: { kind: 'document', owner: 'grade' }, adjustmentKind: 'grade',
      stack: { id: 'stack-1', revision: 0, totalModules: 0, truncated: false, modules: [] } });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 4,
      target: { kind: 'document', owner: 'grade' } };
    expect(await adapter.invoke(request('adjustment.query', parameters)))
      .toMatchObject({ status: 'completed', value: { adjustmentKind: 'grade' } });
    expect(driver.queryAdjustment).toHaveBeenCalledWith('document-1', parameters);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('accepts one committed tool call without requiring live MCP pointer streaming', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    const samples = [{ x: 10, y: 20, pressure: 1 }, { x: 30, y: 40, pressure: 0.5 }];
    expect(await adapter.invoke(request('command.execute', {
      command: 'tool.commitGesture', documentId: 'document-1',
      commandRequestId: 'stroke-1', commandParameters: {
        kind: 'brush-stroke', parameters: { layerId: 'layer-1', channel: 'pixels', brush: {
          presetId: 'round', size: 24, hardness: 0.75, opacity: 1, flow: 0.5,
          spacing: 0.05, smooth: 0.2, color: '#112233', backgroundColor: '#ffffff'
        } }, samples
      }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tool.commitGesture', parameters: expect.objectContaining({ samples })
    }), { origin: 'mcp', recording: 'record' });
  });

  it('keeps Face Warp outside the current remote rollout profile', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'faceWarp.applyOperation', documentId: 'document-1',
      commandRequestId: 'face-warp-1', commandParameters: {
        layerId: 'portrait', operation: {
          kind: 'set-protection', faceId: 'face-1', feature: 'lips', locked: true
        }
      }
    }))).toMatchObject({ status: 'rejected', code: 'command-not-allowed' });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('forwards atomic batches, cancellation and event cursors', async () => {
    const driver = createDriver();
    vi.mocked(driver.queryTaskEvents).mockReturnValue({ cursor: 4, events: [] });
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('task.events', { afterCursor: 2, limit: 50 })))
      .toMatchObject({ status: 'completed', value: { cursor: 4 } });
    expect(await adapter.invoke(request('command.execute', { command: 'command.batch',
      documentId: 'document-1', commandRequestId: 'batch-1', commandParameters: {
        name: 'Build', operations: [{ operationId: 'rename', command: 'layer.rename',
          parameters: { layerId: 'layer-1', name: 'Hero' } }]
      } }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'command.batch' }),
      { origin: 'mcp', recording: 'record' }
    );
  });

  it('expires and bounds sessions and their activity history', async () => {
    const driver = createDriver();
    const expired = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 1_000, now: () => 1_000
    });
    expect(await expired.invoke(request('workspace.query')))
      .toMatchObject({ status: 'rejected', code: 'session-expired' });

    const bounded = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000, requestLimit: 1
    });
    expect((await bounded.invoke(request('workspace.query'))).status).toBe('completed');
    expect(await bounded.invoke(request('workspace.query')))
      .toMatchObject({ status: 'rejected', code: 'request-limit-reached' });
  });
});
