import { layerIsLocked } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import type { DocumentSession } from '../documents/documentSession';
import type { AutomationTaskEventStore } from './automationTaskEventStore';
import type { LightTableCommandPorts } from './lightTableCommandContract';
import { parseSemanticAutoAlignCommand, type SemanticAutoAlignCommand }
  from './semanticAutoAlignCommandContract';

type AutoAlignTaskStart = { readonly taskId: string }
  | { readonly error: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };

const semanticAutoAlignResult = (command: SemanticAutoAlignCommand, value: unknown) => ({
  changed: !(typeof value === 'object' && value !== null
    && 'changed' in value && value.changed === false),
  referenceLayerId: command.referenceLayerId,
  targetLayerId: command.targetLayerId
});

const startAutoAlignTask = (
  session: DocumentSession,
  ports: LightTableCommandPorts,
  command: SemanticAutoAlignCommand,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): string | null => {
  const name = 'Auto Align';
  const running = session.tasks.run('automation', name, async (task) => {
    events.append(task.id, 'running', { progress: 0, message: name });
    const internalValue = await ports.executeAutoAlign!(session.id, command, task.signal);
    task.throwIfCanceled();
    return semanticAutoAlignResult(command, internalValue);
  }, { replace: false });
  const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1) ?? null;
  if (!taskId) return null;
  events.append(taskId, 'queued', { progress: 0, message: name });
  void running.then((result) => {
    if (result.status === 'completed') {
      if (!(typeof result.value === 'object' && result.value !== null
        && 'changed' in result.value && result.value.changed === false)) session.markChanged();
      onComplete(taskId, result.value);
      events.append(taskId, 'completed', { progress: 1, message: name });
    } else if (result.status === 'failed') events.append(taskId, 'failed', { message: result.error.message });
    else events.append(taskId, 'canceled', { message: name });
  });
  return taskId;
};

export const startValidatedAutoAlignTask = (
  parameters: unknown,
  session: DocumentSession,
  ports: LightTableCommandPorts,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): AutoAlignTaskStart => {
  const command = parseSemanticAutoAlignCommand(parameters);
  if ('message' in command) return { error: 'invalid-parameters', message: command.message };
  if (!ports.executeAutoAlign) return { error: 'command-unavailable', message: 'Auto Align is unavailable in this host.' };
  const document = session.getSnapshot().document!;
  const reference = findRasterLayer(document, command.referenceLayerId);
  const target = findRasterLayer(document, command.targetLayerId);
  if (!reference || !target) return { error: 'command-unavailable', message: 'Auto Align requires two existing raster layers.' };
  if (!reference.visible || !target.visible) return { error: 'command-unavailable', message: 'Auto Align requires two visible layers.' };
  if (layerIsLocked(target, 'position')) return { error: 'command-unavailable', message: 'Unlock the target layer position before Auto Align.' };
  const taskId = startAutoAlignTask(session, ports, command, events, onComplete);
  return taskId ? { taskId } : { error: 'execution-failed', message: 'Auto Align did not start.' };
};
