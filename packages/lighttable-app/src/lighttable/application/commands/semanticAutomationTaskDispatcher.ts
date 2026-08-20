import type { DocumentSession } from '../documents/documentSession';
import type { AutomationTaskEventStore } from './automationTaskEventStore';
import { startValidatedAutoAlignTask } from './autoAlignTask';
import { startValidatedBackgroundRemovalTask } from './backgroundRemovalTask';
import { startValidatedSubjectSelectionTask } from './subjectSelectionTask';
import type { LightTableCommandPorts } from './lightTableCommandContract';

export const startSemanticAutomationTask = (
  command: string,
  parameters: unknown,
  session: DocumentSession,
  ports: LightTableCommandPorts,
  events: AutomationTaskEventStore,
  onComplete: (taskId: string, value: unknown) => void
) => command === 'layer.removeBackground'
  ? startValidatedBackgroundRemovalTask(parameters, session, ports, events, onComplete)
  : command === 'layer.autoAlign'
    ? startValidatedAutoAlignTask(parameters, session, ports, events, onComplete)
    : command === 'selection.selectSubject'
      ? startValidatedSubjectSelectionTask(parameters, session, ports, events, onComplete)
      : null;
