import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { resolveAcceptedCommandArtifact } from './resolveAcceptedCommandArtifact';

const documentId = 'document-1' as DocumentSessionId;
const accepted = { requestId: 'export', status: 'accepted' as const, taskId: 'task-1',
  revisions: { workspace: 1, document: 2, historyState: 0 } };

describe('resolveAcceptedCommandArtifact', () => {
  it('waits for one completed task artifact and resolves its File', async () => {
    const file = new File(['png'], 'result.png', { type: 'image/png' });
    const queryTask = vi.fn()
      .mockReturnValueOnce({ id: 'task-1', status: 'running', progress: 0.5, error: null,
        elapsedMs: 10, durationMs: null, artifact: null })
      .mockReturnValue({ id: 'task-1', status: 'completed', progress: 1, error: null,
        elapsedMs: 20, durationMs: 20,
        artifact: { id: 'artifact-1', kind: 'png-export', name: file.name, mediaType: file.type,
          byteLength: file.size, createdAt: 1 } });
    await expect(resolveAcceptedCommandArtifact({
      queryTask,
      resolveArtifact: (id) => id === 'artifact-1' ? file : null
    }, documentId, accepted, { timeoutMs: 1_000 })).resolves.toMatchObject({
      artifact: { id: 'artifact-1' }, file
    });
    expect(queryTask).toHaveBeenCalledTimes(2);
  });

  it('fails closed for rejected, failed and missing artifacts', async () => {
    await expect(resolveAcceptedCommandArtifact({ queryTask: () => null, resolveArtifact: () => null },
      documentId, { requestId: 'bad', status: 'rejected', code: 'command-unavailable',
        message: 'No renderer', revisions: { workspace: 1 } })).rejects.toThrow('No renderer');
    await expect(resolveAcceptedCommandArtifact({ queryTask: () => ({ id: 'task-1', status: 'failed',
      progress: null, error: 'GPU failed', elapsedMs: 5, durationMs: 5, artifact: null }),
    resolveArtifact: () => null },
    documentId, accepted)).rejects.toThrow('GPU failed');
    await expect(resolveAcceptedCommandArtifact({ queryTask: () => null, resolveArtifact: () => null },
      documentId, accepted)).rejects.toThrow('no longer available');
    await expect(resolveAcceptedCommandArtifact({ queryTask: () => ({ id: 'task-1', status: 'completed',
      progress: 1, error: null, elapsedMs: 5, durationMs: 5,
      artifact: { id: 'gone', kind: 'png-export', name: 'gone.png',
        mediaType: 'image/png', byteLength: 1, createdAt: 1 } }),
    resolveArtifact: () => null }, documentId, accepted)).rejects.toThrow('no longer available');
  });
});
