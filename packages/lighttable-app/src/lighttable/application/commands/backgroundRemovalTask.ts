import type { DocumentSession } from '../documents/documentSession';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { AutomationTaskEventStore } from './automationTaskEventStore';
import type { LightTableCommandPorts } from './lightTableCommandContract';
import type { SemanticBackgroundRemovalCommand } from './semanticBackgroundRemovalCommandContract';
import { parseSemanticBackgroundRemovalCommand } from './semanticBackgroundRemovalCommandContract';
import { createBoundedTaskProgress } from '../tasks/boundedTaskProgress';

type BackgroundRemovalTaskStart = { readonly taskId: string }
  | { readonly error: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };

export const startValidatedBackgroundRemovalTask = (
  parameters: unknown,
  session: DocumentSession,
  ports: LightTableCommandPorts,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): BackgroundRemovalTaskStart => {
  const command = parseSemanticBackgroundRemovalCommand(parameters);
  if ('message' in command) return { error: 'invalid-parameters', message: command.message };
  if (!ports.executeBackgroundRemoval) return { error: 'command-unavailable',
    message: 'Remove Background is unavailable in this host.' };
  const layer = findDocumentLayer(session.getSnapshot().document!, command.layerId);
  if (layer?.type !== 'raster') return { error: 'command-unavailable',
    message: 'Remove Background requires an existing raster layer.' };
  if (layer.locks.all || layer.locks.pixels) return { error: 'command-unavailable',
    message: 'Unlock the target raster layer before removing its background.' };
  const taskId = startBackgroundRemovalTask(session, ports, command, events, onComplete);
  return taskId ? { taskId } : { error: 'execution-failed', message: 'Remove Background did not start.' };
};

export const startBackgroundRemovalTask = (
  session: DocumentSession,
  ports: LightTableCommandPorts,
  command: SemanticBackgroundRemovalCommand,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): string | null => {
  if (!ports.executeBackgroundRemoval) return null;
  const name = 'Remove Background';
  const running = session.tasks.run('automation', name, async (task) => {
    events.append(task.id, 'running', { progress: 0, message: name });
    const report = createBoundedTaskProgress((progress, message) => {
      task.reportProgress(progress);
      events.append(task.id, 'progress', { progress, message });
    }, { minimumIntervalMs: 500 });
    await ports.executeBackgroundRemoval!(session.id, command, task.signal, report);
    task.throwIfCanceled();
    return { layerId: command.layerId, mode: command.mode };
  }, { replace: false });
  const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1) ?? null;
  if (!taskId) return null;
  events.append(taskId, 'queued', { progress: 0, message: name });
  void running.then((result) => {
    if (result.status === 'completed') {
      session.markChanged();
      onComplete(taskId, result.value);
      events.append(taskId, 'completed', { progress: 1, message: name });
    } else if (result.status === 'failed') {
      events.append(taskId, 'failed', { message: result.error.message });
    } else events.append(taskId, 'canceled', { message: name });
  });
  return taskId;
};
