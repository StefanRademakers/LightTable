import { describe, expect, it, vi } from 'vitest';
import { SemanticActionPlaybackController } from './semanticActionPlayback';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Test', startedAt: 1, stoppedAt: 2,
  byteLength: 10, limitReached: false,
  steps: [{
    sequence: 1, requestId: 'recorded-1', command: 'layer.createRaster', documentId: 'document-1',
    origin: 'ui',
    parameters: {}, outcome: 'completed', result: {}, startedAt: 1, durationMs: 1,
    replayable: true, note: null
  }, {
    sequence: 2, requestId: 'recorded-2', command: 'layer.rename', documentId: 'document-1',
    origin: 'ui',
    parameters: { layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Title' },
    outcome: 'completed', result: { layerId: 'old-layer', name: 'Title' }, startedAt: 2, durationMs: 1,
    replayable: true, note: null
  }, {
    sequence: 3, requestId: 'recorded-3', command: 'history.undo', documentId: 'document-1',
    origin: 'ui',
    parameters: {}, outcome: 'completed', result: {}, startedAt: 2, durationMs: 1,
    replayable: false, note: 'diagnostic'
  }]
});

describe('SemanticActionPlaybackController', () => {
  it('plays replayable steps through the supplied semantic executor', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'layer.createRaster' ? { layerId: 'new-layer-for-this-run' } : {},
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(recording());

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'layer.createRaster', documentId: 'document-1', parameters: {}
    }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.rename',
      parameters: { layerId: 'new-layer-for-this-run', name: 'Title' }
    }));
    expect(controller.snapshot()).toMatchObject({
      status: 'completed', results: [
        { sequence: 1, status: 'completed' }, { sequence: 2, status: 'completed' }
      ]
    });
  });

  it('retargets every document-scoped step to the current active document', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'layer.createRaster' ? { layerId: 'fresh-layer' } : {},
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(recording(), 'fresh-document');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([request]) => request.documentId === 'fresh-document')).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parameters: { layerId: 'fresh-layer', name: 'Title' }
    }));
  });

  it('awaits an accepted task and binds its artifact into the following step', async () => {
    const asyncRecording: ActionRecordingSnapshot = {
      ...recording(), steps: [{ ...recording().steps[0]!, command: 'file.exportNative',
        outcome: 'accepted', result: { taskId: 'old-task', artifact: { id: 'old-artifact' } },
        parameters: {} }, { ...recording().steps[1]!, command: 'file.openArtifact',
        documentId: null, parameters: {
          artifactId: { $lighttableResult: { step: 1, path: 'artifact.id' } }
        } }]
    };
    const execute = vi.fn(async (request) => request.command === 'file.exportNative'
      ? { requestId: request.requestId, status: 'accepted' as const, taskId: 'new-task',
          revisions: { workspace: 1 } }
      : { requestId: request.requestId, status: 'completed' as const, value: {},
          revisions: { workspace: 1 } });
    const progress = vi.fn();
    const controller = new SemanticActionPlaybackController(execute, { wait: async (
      _documentId, taskId, _signal, onProgress
    ) => {
      expect(taskId).toBe('new-task'); onProgress(0.5); progress();
      return { status: 'completed', value: { artifact: { id: 'new-artifact' } } };
    } });

    await controller.play(asyncRecording, 'fresh-document');

    expect(progress).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'file.openArtifact', parameters: { artifactId: 'new-artifact' }
    }));
    expect(controller.snapshot()).toMatchObject({ status: 'completed', taskProgress: null,
      results: [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'completed' }] });
  });

  it('stops and aborts the current accepted task without running later steps', async () => {
    const acceptedRecording: ActionRecordingSnapshot = {
      ...recording(), steps: [{ ...recording().steps[0]!, command: 'command.batch',
        outcome: 'accepted', result: { taskId: 'old-task' } }, recording().steps[1]!]
    };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'accepted' as const, taskId: 'new-task', revisions: { workspace: 1 } }));
    const canceled = vi.fn();
    const controller = new SemanticActionPlaybackController(execute, { wait: (
      _documentId, _taskId, signal
    ) => new Promise((resolve) => signal.addEventListener('abort', () => {
      canceled(); resolve({ status: 'canceled', message: 'Stopped.' });
    }, { once: true })) });

    const playing = controller.play(acceptedRecording);
    await vi.waitFor(() => expect(controller.snapshot().currentSequence).toBe(1));
    controller.stop();
    await playing;

    expect(canceled).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ status: 'stopped', currentSequence: null });
  });

  it.each([
    ['failed', 'task-failed'], ['timeout', 'task-timeout'], ['missing', 'task-missing']
  ] as const)('fails closed when an accepted task is %s', async (taskStatus, resultStatus) => {
    const acceptedRecording: ActionRecordingSnapshot = {
      ...recording(), steps: [{ ...recording().steps[0]!, command: 'command.batch',
        outcome: 'accepted', result: { taskId: 'old-task' } }, recording().steps[1]!]
    };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'accepted' as const, taskId: 'new-task', revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute, { wait: async () => ({
      status: taskStatus, message: `Task ${taskStatus}.`
    }) });

    await controller.play(acceptedRecording);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ status: 'failed',
      results: [{ status: resultStatus, message: `Task ${taskStatus}.` }] });
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
