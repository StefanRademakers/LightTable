import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sam2SmartSelectionBackend } from './Sam2SmartSelectionBackend';
import { SAM2_SMALL_PROFILE } from './smartSelectionModels';

const posted: unknown[] = [];
class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown) { posted.push(message); }
  terminate() {}
}

describe('Sam2SmartSelectionBackend', () => {
  beforeEach(() => { posted.length = 0; vi.stubGlobal('Worker', WorkerStub); });

  it('pins the balanced artifact and maps points plus a document-space box', async () => {
    const backend = new Sam2SmartSelectionBackend();
    expect(backend.identity).toEqual(SAM2_SMALL_PROFILE);
    const pending = backend.selectPrompt({ id: 'prepared', sourceKey: 'source',
      documentRevision: 1, width: 100, height: 80 }, {
      points: [{ point: { x: 10, y: 12 }, label: 'negative' }],
      box: { x: 4, y: 6, width: 50, height: 60 }
    }, { refineEdges: true, refinementQuality: 'standard' });
    expect(posted[0]).toMatchObject({ type: 'points', sourceId: 'prepared',
      points: [[10, 12]], labels: [0], box: [4, 6, 54, 66],
      refineEdges: true, refinementQuality: 'standard' });
    backend.dispose();
    await expect(pending).rejects.toThrow('Smart selection was canceled.');
  });

  it('includes model identity in the prepared embedding cache key', async () => {
    const backend = new Sam2SmartSelectionBackend();
    const pending = backend.prepare({ key: 'document:1:layer', documentRevision: 1,
      width: 4, height: 4, image: new Blob() });
    expect(posted[0]).toMatchObject({ type: 'prepare', profile: 'sam2-small', revision: 1 });
    expect((posted[0] as { sourceId: string }).sourceId).toContain(SAM2_SMALL_PROFILE.artifactRevision);
    backend.dispose();
    await expect(pending).rejects.toThrow('Smart selection was canceled.');
  });
});
