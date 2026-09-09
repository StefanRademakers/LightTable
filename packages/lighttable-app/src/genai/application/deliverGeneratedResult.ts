import type { GenAiGenerationJob } from '@lighttable/genai-core';
import type { LightTableAutomationDriver } from '../../lighttable/application/commands/lightTableCommandService';
import type { DocumentSessionId } from '../../lighttable/application/documents/documentSession';
import type { DocumentTaskRegistry } from '../../lighttable/application/tasks/documentTaskRegistry';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { executeUiPlaceArtifact } from '../../lighttable/application/documents/executeUiPlaceArtifact';

interface DeliverGeneratedResultOptions {
  readonly job: GenAiGenerationJob;
  readonly projectId: string;
  readonly service: Pick<LightTableGenAiService, 'loadProjectAsset'>;
  readonly tasks: DocumentTaskRegistry;
  readonly commandDriver: Pick<
    LightTableAutomationDriver,
    'execute' | 'registerInputArtifact' | 'releaseArtifact'
  >;
  readonly documentId: DocumentSessionId;
  readonly documentIsImage: boolean;
  readonly forceOpen?: boolean;
  readonly isCurrent: () => boolean;
  readonly openDocument: (file: File) => Promise<void>;
}

const cancellation = () => new DOMException('Generated-result delivery was canceled.', 'AbortError');

/** Loads one durable generation result, then crosses exactly one UI command boundary. */
export const deliverGeneratedResult = async ({
  job,
  projectId,
  service,
  tasks,
  commandDriver,
  documentId,
  documentIsImage,
  forceOpen = false,
  isCurrent,
  openDocument
}: DeliverGeneratedResultOptions): Promise<boolean> => {
  const result = job.results[0];
  if (!result) throw new Error('The generation did not produce a result.');
  const target = job.request.editorDelivery;
  // Automatic delivery is allowed only inside the project that submitted the
  // job. Legacy jobs without persisted provenance remain available through
  // the explicit History Open action (`forceOpen`), but never auto-deliver.
  if (!forceOpen && (!target || target.projectId !== projectId)) return false;
  if (!forceOpen && target?.behavior === 'place-edit' && target.documentId !== documentId) return false;

  const delivery = await tasks.run('import', 'Import generated result', async (task) => {
    if (!isCurrent()) throw cancellation();
    task.throwIfCanceled();
    const payload = await service.loadProjectAsset(projectId, result.assetId);
    if (!payload) throw new Error('The generated result is no longer available.');
    if (!isCurrent()) throw cancellation();
    task.throwIfCanceled();

    const file = new File(
      [Uint8Array.from(payload.bytes).buffer],
      payload.name,
      { type: payload.mediaType }
    );
    const placeIntoDocument = target?.behavior === 'place-edit'
      && target.projectId === projectId
      && target.documentId === documentId
      && documentIsImage
      && !result.mediaType.startsWith('video/')
      && !forceOpen;
    if (!placeIntoDocument) {
      await openDocument(file);
      return;
    }

    // Cancellation ends here: once the semantic command starts it owns its
    // terminal commit/rollback and must report that definitive result.
    await executeUiPlaceArtifact(commandDriver, documentId, file);
  }, { replace: false, completionPolicy: 'operation-result' });

  if (delivery.status === 'failed') throw delivery.error;
  return delivery.status === 'completed';
};
