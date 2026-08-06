import type { DocumentSession } from '../documents/documentSession';
import type { LightTableCommandPorts } from './lightTableCommandContract';
import type { AtomicCommandBatch } from './atomicCommandBatchContract';
import type { AutomationTaskEventStore } from './automationTaskEventStore';

export const startAtomicCommandBatchTask = (
  session: DocumentSession,
  ports: LightTableCommandPorts,
  batch: AtomicCommandBatch,
  events: AutomationTaskEventStore
): string | null => {
  const running = session.tasks.run('automation', batch.name, async (task) => {
    await Promise.resolve();
    events.append(task.id, 'running', { progress: 0, message: batch.name });
    const timer = globalThis.setTimeout(() => session.tasks.cancel(task.id), batch.timeoutMs);
    try {
      const result = await ports.executeAtomicBatch(session.id, batch, task.signal,
        (completed, operationId) => {
          const progress = completed / batch.operations.length;
          task.reportProgress(progress);
          events.append(task.id, 'progress', { progress, operationId, message: batch.name });
        });
      task.throwIfCanceled();
      return result;
    } finally { globalThis.clearTimeout(timer); }
  }, { replace: false });
  const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1) ?? null;
  if (!taskId) return null;
  events.append(taskId, 'queued', { progress: 0, message: batch.name });
  void running.then((result) => {
    if (result.status === 'completed') {
      session.markChanged();
      events.append(taskId, 'completed', { progress: 1, message: batch.name });
    } else if (result.status === 'failed') {
      events.append(taskId, 'failed', { message: result.error.message });
    } else events.append(taskId, 'canceled', { message: batch.name });
  });
  return taskId;
};
