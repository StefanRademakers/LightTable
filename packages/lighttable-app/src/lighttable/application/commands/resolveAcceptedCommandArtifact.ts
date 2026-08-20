import type { DocumentSessionId } from '../documents/documentSession';
import type {
  AutomationTaskQueryResult,
  LightTableCommandResult
} from './lightTableCommandContract';
import type { LightTableArtifactMetadata } from './lightTableArtifactRegistry';

export interface AcceptedCommandArtifactPort {
  queryTask(documentId: DocumentSessionId, taskId: string): AutomationTaskQueryResult | null;
  resolveArtifact(artifactId: string): File | null;
}

export interface ResolvedCommandArtifact {
  readonly artifact: LightTableArtifactMetadata;
  readonly file: File;
}

export const resolveAcceptedCommandArtifact = async (
  port: AcceptedCommandArtifactPort,
  documentId: DocumentSessionId,
  result: LightTableCommandResult,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}
): Promise<ResolvedCommandArtifact> => {
  if (result.status !== 'accepted') {
    throw new Error(result.status === 'rejected'
      ? result.message
      : 'The artifact command did not start an asynchronous task.');
  }
  const timeoutMs = Math.max(100, Math.min(120_000, options.timeoutMs ?? 120_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DOMException('Artifact delivery was canceled.', 'AbortError');
    const task = port.queryTask(documentId, result.taskId);
    if (!task) throw new Error('The accepted artifact task is no longer available.');
    if (task?.status === 'failed') throw new Error(task.error ?? 'Artifact export failed.');
    if (task?.status === 'canceled') throw new Error('Artifact export was canceled.');
    if (task?.status === 'completed' && task.artifact) {
      const file = port.resolveArtifact(task.artifact.id);
      if (!file) throw new Error('The completed artifact is no longer available.');
      return { artifact: task.artifact, file };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Artifact export exceeded ${timeoutMs} ms.`);
};
