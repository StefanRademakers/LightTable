import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { WorkspaceSession } from '../workspace/workspaceSession';
import type { LightTableCommandPorts } from './lightTableCommandContract';
import { AutomationTaskEventStore } from './automationTaskEventStore';
import { startBackgroundRemovalTask } from './backgroundRemovalTask';
import { startValidatedAutoAlignTask } from './autoAlignTask';
import { startAtomicCommandBatchTask } from './atomicCommandBatchTask';

const runTask = async (kind: 'background' | 'align' | 'batch', mutation: 'none' | 'document' | 'pixels') => {
  const workspace = new WorkspaceSession({ createId: () => 'task-revision' as never });
  const opened = workspace.open({ source: { id: 'source', name: 'Source.png', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Fixture document did not open.');
  const session = opened.value;
  session.setDocument(createRasterLayer(createImageDocument('Task', 64, 32, 'source')));
  session.setReady();
  session.markSaved();
  const before = session.getSnapshot().documentRevision;
  let publishedRevision = before;
  const markChanged = vi.spyOn(session, 'markChanged');
  const operation = async () => {
    if (mutation === 'document') {
      const document = session.getSnapshot().document!;
      session.setDocument({ ...document, name: 'Changed', revision: document.revision + 1 });
    } else if (mutation === 'pixels') {
      // Pixel history can change authored state without replacing the layer tree.
      const reservation = session.history.reserve({ id: 'pixels', type: 'raster.paint', label: 'Paint',
        documentId: session.id, undo() {}, redo() {} });
      expect(session.getSnapshot().documentRevision).toBe(before);
      expect(reservation.commit()).toBe(true);
    }
    publishedRevision = session.getSnapshot().documentRevision;
    return { changed: true, results: [] };
  };
  const ports = { executeBackgroundRemoval: operation, executeAutoAlign: operation,
    executeAtomicBatch: operation } as unknown as LightTableCommandPorts;
  const events = new AutomationTaskEventStore();
  const completed = new Promise<void>((resolve, reject) => {
    const disconnect = events.subscribe(() => {
      const terminal = events.query().events.find(event => ['completed', 'failed', 'canceled'].includes(event.status));
      if (!terminal) return;
      disconnect();
      if (terminal.status === 'completed') resolve(); else reject(new Error(terminal.message ?? terminal.status));
    });
  });
  const [first, second] = session.getSnapshot().document!.layers;
  let started: unknown;
  if (kind === 'background') started = startBackgroundRemovalTask(session, ports,
    { layerId: first!.id, mode: 'replace' }, events, () => undefined);
  else if (kind === 'align') started = startValidatedAutoAlignTask({ referenceLayerId: first!.id,
    targetLayerId: second!.id }, session, ports, events, () => undefined);
  else started = startAtomicCommandBatchTask(session, ports, {
    name: 'Batch', timeoutMs: 1000,
    operations: [{ operationId: 'rename', command: 'layer.rename', parameters: { layerId: first!.id, name: 'New' } }]
  }, events);
  expect(started).toBeTruthy();
  try {
    await completed;
    const after = session.getSnapshot().documentRevision;
    return { before, publishedRevision, after, markChangedCalls: markChanged.mock.calls.length };
  } finally {
    markChanged.mockRestore();
    workspace.dispose();
  }
};

describe('task completion observes canonical revision ownership', () => {
  it.each(['background', 'align', 'batch'] as const)('%s completion does not turn a successful no-op into a mutation', async kind => {
    const result = await runTask(kind, 'none');
    expect(result.after).toBe(result.before);
    expect(result.markChangedCalls).toBe(0);
  });

  it.each(['background', 'align', 'batch'] as const)('%s does not add a revision after its canonical owner publishes', async kind => {
    const result = await runTask(kind, 'document');
    expect(result.after).toBe(result.publishedRevision);
    expect(result.publishedRevision).toBeGreaterThan(result.before);
  });

  it('retains the central pixel-history revision without a completion stamp', async () => {
    const result = await runTask('background', 'pixels');
    expect(result.after).toBe(result.publishedRevision);
    expect(result.publishedRevision).toBeGreaterThan(result.before);
  });
});
