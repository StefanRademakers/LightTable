import { describe, expect, it, vi } from 'vitest';
import type { LightTableAutomationDriver } from '@lighttable/app';
import { invokeAgentDriver } from './agentDriverBridge';

const driverWith = (overrides: Partial<LightTableAutomationDriver>): LightTableAutomationDriver => (
  overrides as LightTableAutomationDriver
);

describe('invokeAgentDriver', () => {
  it('filters capability discovery to commands allowed through Agent Access', async () => {
    const driver = driverWith({
      queryCapabilities: vi.fn(() => ([
        { command: 'layer.rename', available: true, reason: null },
        { command: 'file.exportPsd', available: true, reason: null },
        { command: 'faceWarp.applyOperation', available: true, reason: null },
        { command: 'document.resizeImage', available: true, reason: null },
        { command: 'document.applyGeometry', available: true, reason: null }
      ] as const))
    });

    await expect(invokeAgentDriver(driver, 'command.capabilities', { documentId: 'document-1' }))
      .resolves.toEqual([
        { command: 'layer.rename', available: true, reason: null },
        { command: 'file.exportPsd', available: true, reason: null },
        { command: 'document.resizeImage', available: true, reason: null },
        { command: 'document.applyGeometry', available: true, reason: null }
      ]);
  });

  it('rejects internal-only commands before they reach the automation driver', async () => {
    const execute = vi.fn();
    const driver = driverWith({ execute });

    await expect(invokeAgentDriver(driver, 'command.execute', {
      documentId: 'document-1', commandRequestId: 'request-1',
      command: 'faceWarp.applyOperation', commandParameters: {}
    })).rejects.toThrow('not exposed through Agent Access');
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves the proven PSD export and bounded artifact-open workflows', async () => {
    const execute = vi.fn(async (request) => ({
      requestId: request.requestId, status: 'completed' as const,
      value: {}, revisions: { workspace: 1 }
    }));
    const driver = driverWith({ execute });

    for (const command of ['file.exportPsd', 'file.openArtifact'] as const) {
      await expect(invokeAgentDriver(driver, 'command.execute', {
        documentId: 'document-1', commandRequestId: `request-${command}`,
        command, commandParameters: { artifactId: 'artifact-1' }
      })).resolves.toMatchObject({ status: 'completed' });
    }
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('forwards basic Grade inspection without executing a command', async () => {
    const queryBasicGrade = vi.fn(() => ({
      target: { kind: 'document' as const }, documentRevision: 2, targetRevision: 2,
      values: { exposureEV: 0.4 }
    } as never));
    const execute = vi.fn();
    const driver = driverWith({ queryBasicGrade, execute });

    await expect(invokeAgentDriver(driver, 'grade.queryBasic', {
      documentId: 'document-1', target: { kind: 'document' }
    })).resolves.toMatchObject({ values: { exposureEV: 0.4 } });
    expect(queryBasicGrade).toHaveBeenCalledWith('document-1', { kind: 'document' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards bounded revision preview requests without executing a command', async () => {
    const requestDocumentPreview = vi.fn(async () => ({ status: 'rejected' as const,
      code: 'stale-document-revision' as const, message: 'stale', currentRevision: 8 }));
    const execute = vi.fn();
    const driver = driverWith({ requestDocumentPreview, execute });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 7, maxEdge: 512 };
    await expect(invokeAgentDriver(driver, 'document.preview', parameters))
      .resolves.toMatchObject({ status: 'rejected', currentRevision: 8 });
    expect(requestDocumentPreview).toHaveBeenCalledWith(parameters);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards revision-bound layer pages without falling back to the unbounded query', async () => {
    const queryLayerPage = vi.fn(() => ({ status: 'completed' as const,
      documentId: 'document-1', canonicalRevision: 8, total: 2, offset: 0,
      limit: 1, truncated: true, nextCursor: 'cursor-1', layers: [] }));
    const queryLayers = vi.fn();
    const driver = driverWith({ queryLayerPage, queryLayers });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 8, limit: 1 };
    await expect(invokeAgentDriver(driver, 'layer.list', parameters))
      .resolves.toMatchObject({ canonicalRevision: 8, truncated: true });
    expect(queryLayerPage).toHaveBeenCalledWith(parameters);
    expect(queryLayers).not.toHaveBeenCalled();
  });

  it('forwards active-layer detail inspection without executing a command', async () => {
    const queryLayerDetail = vi.fn(() => ({ status: 'rejected' as const,
      code: 'no-active-layer' as const, message: 'missing' }));
    const execute = vi.fn();
    const driver = driverWith({ queryLayerDetail, execute });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 8 };
    await expect(invokeAgentDriver(driver, 'layer.query', parameters))
      .resolves.toMatchObject({ code: 'no-active-layer' });
    expect(queryLayerDetail).toHaveBeenCalledWith(parameters);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards revision-bound adjustment inspection without executing a command', async () => {
    const queryAdjustment = vi.fn(() => ({ status: 'rejected' as const,
      code: 'stale-document-revision' as const, message: 'stale', currentRevision: 8 }));
    const execute = vi.fn();
    const driver = driverWith({ queryAdjustment, execute });
    const parameters = { documentId: 'document-1', expectedDocumentRevision: 7,
      target: { kind: 'document', owner: 'grade' } };
    await expect(invokeAgentDriver(driver, 'adjustment.query', parameters))
      .resolves.toMatchObject({ code: 'stale-document-revision', currentRevision: 8 });
    expect(queryAdjustment).toHaveBeenCalledWith('document-1', parameters);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards isolated layer previews without executing a command', async () => {
    const requestLayerPreview = vi.fn(async () => ({ status: 'rejected' as const,
      code: 'channel-unavailable' as const, message: 'missing mask' }));
    const execute = vi.fn();
    const driver = driverWith({ requestLayerPreview, execute });
    const parameters = { documentId: 'document-1', layerId: 'layer-1', channel: 'mask',
      expectedDocumentRevision: 8, maxEdge: 512 };
    await expect(invokeAgentDriver(driver, 'layer.preview', parameters))
      .resolves.toMatchObject({ code: 'channel-unavailable' });
    expect(requestLayerPreview).toHaveBeenCalledWith(parameters);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards publication event cursors without executing a command', async () => {
    const queryPublicationEvents = vi.fn(() => ({ cursor: 6, latestCursor: 8,
      oldestCursor: 1, gap: false, hasMore: true, events: [] }));
    const execute = vi.fn();
    const driver = driverWith({ queryPublicationEvents, execute });
    await expect(invokeAgentDriver(driver, 'event.query', { afterCursor: 4, limit: 2 }))
      .resolves.toMatchObject({ cursor: 6, latestCursor: 8, hasMore: true });
    expect(queryPublicationEvents).toHaveBeenCalledWith(4, 2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards bounded publication waits without executing a command', async () => {
    const waitForPublicationEvents = vi.fn(async () => ({ cursor: 8, latestCursor: 8,
      oldestCursor: 1, gap: false, hasMore: false, timedOut: false,
      events: [{ cursor: 8, kind: 'renderer-changed' }] } as never));
    const execute = vi.fn();
    const driver = driverWith({ waitForPublicationEvents, execute });
    await expect(invokeAgentDriver(driver, 'event.wait', {
      afterCursor: 7, limit: 20, timeoutMs: 4_000
    })).resolves.toMatchObject({ cursor: 8, timedOut: false });
    expect(waitForPublicationEvents).toHaveBeenCalledWith(7, 20, 4_000);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards bounded Warp recipe inspection without executing a command', async () => {
    const queryWarp = vi.fn(() => ({ totalStrokes: 1, totalSamples: 2 } as never));
    const execute = vi.fn();
    const driver = driverWith({ queryWarp, execute });
    await expect(invokeAgentDriver(driver, 'warp.query', {
      documentId: 'document-1', layerId: 'layer-1'
    })).resolves.toMatchObject({ totalStrokes: 1, totalSamples: 2 });
    expect(queryWarp).toHaveBeenCalledWith('document-1', 'layer-1');
    expect(execute).not.toHaveBeenCalled();
  });

  it('exposes host-owned gesture cleanup without pointer simulation', async () => {
    const cancelAllGestures = vi.fn(async () => 2);
    const driver = driverWith({ cancelAllGestures });
    await expect(invokeAgentDriver(driver, 'gesture.cancelAll', {})).resolves.toBe(2);
    expect(cancelAllGestures).toHaveBeenCalledWith(undefined);
  });
});
