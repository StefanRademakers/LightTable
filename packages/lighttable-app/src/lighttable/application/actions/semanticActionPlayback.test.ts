import { describe, expect, it, vi } from 'vitest';
import { SemanticActionPlaybackController } from './semanticActionPlayback';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Test', startedAt: 1, stoppedAt: 2,
  byteLength: 10, limitReached: false,
  steps: [{
    sequence: 1, requestId: 'recorded-1', command: 'layer.createRaster', documentId: 'document-1',
    parameters: {}, outcome: 'completed', result: {}, startedAt: 1, durationMs: 1,
    replayable: true, note: null
  }, {
    sequence: 2, requestId: 'recorded-2', command: 'history.undo', documentId: 'document-1',
    parameters: {}, outcome: 'completed', result: {}, startedAt: 2, durationMs: 1,
    replayable: false, note: 'diagnostic'
  }]
});

describe('SemanticActionPlaybackController', () => {
  it('plays replayable steps through the supplied semantic executor', async () => {
    const execute = vi.fn(async (request) => ({
      requestId: request.requestId, status: 'completed' as const, value: {}, revisions: { workspace: 1 }
    }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(recording());

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'layer.createRaster', documentId: 'document-1', parameters: {}
    }));
    expect(controller.snapshot()).toMatchObject({
      status: 'completed', results: [{ sequence: 1, status: 'completed' }]
    });
  });

  it('stops at the first rejected step and exposes its error', async () => {
    const execute = vi.fn(async (request) => ({
      requestId: request.requestId, status: 'rejected' as const, code: 'command-unavailable' as const,
      message: 'Target is gone.', revisions: { workspace: 1 }
    }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.playStep(recording(), 1);

    expect(controller.snapshot()).toMatchObject({
      status: 'failed', currentSequence: 1,
      results: [{ sequence: 1, status: 'rejected', message: 'Target is gone.' }]
    });
  });
});
