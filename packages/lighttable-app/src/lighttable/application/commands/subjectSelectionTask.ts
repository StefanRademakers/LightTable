import { findDocumentLayer } from '../../editor/document/layerTree';
import type { DocumentSession } from '../documents/documentSession';
import type { AutomationTaskEventStore } from './automationTaskEventStore';
import type { LightTableCommandPorts } from './lightTableCommandContract';
import { parseSemanticSubjectSelectionCommand, type SemanticSubjectSelectionCommand }
  from './semanticSubjectSelectionCommandContract';
import { createBoundedTaskProgress } from '../tasks/boundedTaskProgress';

type SubjectSelectionTaskStart = { readonly taskId: string }
  | { readonly error: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };

const startSubjectSelectionTask = (
  session: DocumentSession,
  ports: LightTableCommandPorts,
  command: SemanticSubjectSelectionCommand,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): string | null => {
  const name = 'Select Subject';
  const running = session.tasks.run('automation', name, async (task) => {
    events.append(task.id, 'running', { progress: 0, message: name });
    const report = createBoundedTaskProgress((progress, message) => {
      task.reportProgress(progress);
      events.append(task.id, 'progress', { progress, message });
    }, { minimumIntervalMs: 250 });
    const value = await ports.executeSubjectSelection!(session.id, command, task.signal, report);
    task.throwIfCanceled();
    return value;
  }, { replace: false });
  const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1) ?? null;
  if (!taskId) return null;
  events.append(taskId, 'queued', { progress: 0, message: name });
  void running.then((result) => {
    if (result.status === 'completed') {
      onComplete(taskId, result.value);
      events.append(taskId, 'completed', { progress: 1, message: name });
    } else if (result.status === 'failed') {
      events.append(taskId, 'failed', { message: result.error.message });
    } else events.append(taskId, 'canceled', { message: name });
  });
  return taskId;
};

export const startValidatedSubjectSelectionTask = (
  parameters: unknown,
  session: DocumentSession,
  ports: LightTableCommandPorts,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
): SubjectSelectionTaskStart => {
  const command = parseSemanticSubjectSelectionCommand(parameters);
  if ('message' in command) return { error: 'invalid-parameters', message: command.message };
  if (!ports.executeSubjectSelection) return {
    error: 'command-unavailable', message: 'Select Subject is unavailable in this host.'
  };
  const document = session.getSnapshot().document!;
  const source = findDocumentLayer(document, command.sourceLayerId);
  if (!source || !source.visible) return {
    error: 'command-unavailable', message: 'Select Subject requires an existing visible source layer.'
  };
  const taskId = startSubjectSelectionTask(session, ports, command, events, onComplete);
  return taskId ? { taskId } : {
    error: 'execution-failed', message: 'Select Subject did not start.'
  };
};
