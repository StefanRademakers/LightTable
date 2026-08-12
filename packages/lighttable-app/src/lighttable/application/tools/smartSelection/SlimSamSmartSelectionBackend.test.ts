import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlimSamSmartSelectionBackend } from './SlimSamSmartSelectionBackend';

const posted: unknown[] = [];

class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown) { posted.push(message); }
  terminate() {}
}

describe('SlimSamSmartSelectionBackend', () => {
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal('Worker', WorkerStub);
  });

  it('maps model-neutral positive/negative history and a box to one worker prompt', async () => {
    const backend = new SlimSamSmartSelectionBackend();
    const pending = backend.selectPrompt({
      id: 'source', sourceKey: 'source', documentRevision: 1, width: 100, height: 80
    }, {
      points: [
        { point: { x: 12, y: 20 }, label: 'positive' },
        { point: { x: 30, y: 40 }, label: 'negative' }
      ],
      box: { x: 4, y: 6, width: 50, height: 60 }
    }, { hardEdge: false });

    expect(posted[0]).toMatchObject({
      type: 'points', sourceId: 'source', points: [[12, 20], [30, 40]],
      labels: [1, 0], box: [4, 6, 54, 66], hardEdge: false
    });
    backend.dispose();
    await expect(pending).rejects.toThrow('Smart selection was canceled.');
  });
});
