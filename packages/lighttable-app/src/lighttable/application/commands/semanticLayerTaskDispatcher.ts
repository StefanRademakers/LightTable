import type { DocumentSession } from '../documents/documentSession';
import type { AutomationTaskEventStore } from './automationTaskEventStore';
import { startValidatedAutoAlignTask } from './autoAlignTask';
import { startValidatedBackgroundRemovalTask } from './backgroundRemovalTask';
import type { LightTableCommandPorts } from './lightTableCommandContract';

export const startSemanticLayerTask = (
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
    : null;
