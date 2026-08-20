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
        { command: 'document.applyGeometry', available: true, reason: null }
      ] as const))
    });

    await expect(invokeAgentDriver(driver, 'command.capabilities', { documentId: 'document-1' }))
      .resolves.toEqual([
        { command: 'layer.rename', available: true, reason: null },
        { command: 'file.exportPsd', available: true, reason: null }
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
});
