import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from './documentSession';
import { executeUiPlaceArtifact } from './executeUiPlaceArtifact';

const documentId = 'document-1' as DocumentSessionId;
const file = new File(['pixels'], 'placed.png', { type: 'image/png' });
const artifact = (id: string) => ({
  id,
  kind: 'input' as const,
  name: file.name,
  mediaType: file.type,
  byteLength: file.size,
  createdAt: 1
});

describe('executeUiPlaceArtifact', () => {
  it('uses a transient non-recorded artifact and releases it after completion', async () => {
    const driver = {
      registerInputArtifact: vi.fn(() => artifact('artifact-1')),
      execute: vi.fn(async () => ({
        requestId: 'place-1',
        status: 'completed' as const,
        value: { layerId: 'layer-1' },
        revisions: { workspace: 1 }
      })),
      releaseArtifact: vi.fn(() => true)
    };

    await executeUiPlaceArtifact(driver, documentId, file);

    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'layer.placeArtifact',
      documentId,
      parameters: { artifactId: 'artifact-1' }
    }), { origin: 'ui', recording: 'ignore' });
    expect(driver.releaseArtifact).toHaveBeenCalledWith('artifact-1');
  });

  it('retains the source if a future Place implementation unexpectedly becomes asynchronous', async () => {
    const driver = {
      registerInputArtifact: vi.fn(() => artifact('artifact-async')),
      execute: vi.fn(async () => ({
        requestId: 'place-async',
        status: 'accepted' as const,
        taskId: 'task-1',
        revisions: { workspace: 1 }
      })),
      releaseArtifact: vi.fn(() => true)
    };

    await expect(executeUiPlaceArtifact(driver, documentId, file))
      .rejects.toThrow('Place unexpectedly continued as a background task');
    expect(driver.releaseArtifact).not.toHaveBeenCalled();
  });

  it('surfaces a structured rejection and still releases the artifact', async () => {
    const driver = {
      registerInputArtifact: vi.fn(() => artifact('artifact-2')),
      execute: vi.fn(async () => ({
        requestId: 'place-2',
        status: 'rejected' as const,
        code: 'document-not-ready' as const,
        message: 'The document is not ready.',
        revisions: { workspace: 1 }
      })),
      releaseArtifact: vi.fn(() => true)
    };

    await expect(executeUiPlaceArtifact(driver, documentId, file))
      .rejects.toThrow('The document is not ready.');
    expect(driver.releaseArtifact).toHaveBeenCalledWith('artifact-2');
  });
});
