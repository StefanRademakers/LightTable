import type { DocumentSessionId } from './documentSession';
import type { LightTableAutomationDriver } from '../commands/lightTableCommandService';

type UiPlaceDriver = Pick<
  LightTableAutomationDriver,
  'execute' | 'registerInputArtifact' | 'releaseArtifact'
>;

/**
 * Places one ephemeral UI file through the public command boundary.
 *
 * The artifact cannot be replayed after release, so this direct UI operation is
 * intentionally excluded from Actions recording. A durable source reference is
 * required before Place can become an Actions/MCP-replayable operation.
 */
export const executeUiPlaceArtifact = async (
  driver: UiPlaceDriver,
  documentId: DocumentSessionId,
  file: File
): Promise<void> => {
  const artifact = driver.registerInputArtifact(file);
  let releaseArtifact = true;
  try {
    const result = await driver.execute({
      protocolVersion: 1,
      requestId: `ui-place-${crypto.randomUUID()}`,
      command: 'layer.placeArtifact',
      documentId,
      parameters: { artifactId: artifact.id }
    }, { origin: 'ui', recording: 'ignore' });
    if (result.status === 'rejected') throw new Error(result.message);
    if (result.status === 'accepted') {
      releaseArtifact = false;
      throw new Error('Place unexpectedly continued as a background task; its source artifact was retained.');
    }
  } finally {
    if (releaseArtifact) driver.releaseArtifact(artifact.id);
  }
};
