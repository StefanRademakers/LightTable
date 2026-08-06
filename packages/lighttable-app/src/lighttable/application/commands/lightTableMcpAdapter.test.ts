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
  registerInputArtifact: vi.fn(),
  queryArtifact: vi.fn(() => null),
  resolveArtifact: vi.fn(() => null),
  listArtifacts: vi.fn(() => []),
  releaseArtifact: vi.fn(() => true),
  queryTask: vi.fn(() => null),
  queryWorkspace: vi.fn(() => ({ revision: 1, activeDocumentId: null, documents: [] })),
  queryDocument: vi.fn(() => null),
  queryLayers: vi.fn(() => null),
  queryLayerEffects: vi.fn(() => null),
  queryText: vi.fn(() => null),
  queryVector: vi.fn(() => null),
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

  it('allows only the explicit command surface and supports revocation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'layer.rename', documentId: 'document-1',
      commandRequestId: 'rename-1', commandParameters: { layerId: 'layer-1', name: 'Renamed' }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'layer.rename' }));
    expect(await adapter.invoke(request('command.execute', { command: 'file.openArtifact' })))
      .toMatchObject({ status: 'rejected', code: 'command-not-allowed' });
    adapter.revoke();
    expect(await adapter.invoke(request('artifact.list')))
      .toMatchObject({ status: 'rejected', code: 'session-revoked' });
    expect(adapter.activity()).toHaveLength(3);
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
    }));
    expect(driver.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.placeArtifact', documentId: 'document-1', expectedDocumentRevision: 2
    }));
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
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'text.format' }));
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
