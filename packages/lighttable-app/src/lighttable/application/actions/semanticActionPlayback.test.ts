import { describe, expect, it, vi } from 'vitest';
import { SemanticActionPlaybackController } from './semanticActionPlayback';
import { SemanticActionRecorder } from './semanticActionRecorder';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const legacyContract = { status: 'legacy-properties-only' as const, schemaVersion: null };
const schemaContract = { status: 'complete' as const, schemaVersion: 1 };
const acceptedBatchStep = () => ({
  ...recording().steps[0]!, command: 'command.batch' as const,
  contract: schemaContract, outcome: 'accepted' as const,
  parameters: { name: 'Batch task', operations: [{
    operationId: 'rename', command: 'layer.rename',
    parameters: { layerId: 'old-layer', name: 'Title' }
  }] },
  result: { taskId: 'old-task' }
});

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Test', startedAt: 1, stoppedAt: 2,
  byteLength: 10, limitReached: false, variables: [],
  steps: [{
    sequence: 1, requestId: 'recorded-1', command: 'layer.createRaster', documentId: 'document-1',
    origin: 'ui',
    contract: schemaContract,
    parameters: {}, outcome: 'completed', result: { created: true, layerId: 'old-layer' }, startedAt: 1, durationMs: 1,
    replayable: true, note: null, rationale: null
  }, {
    sequence: 2, requestId: 'recorded-2', command: 'layer.rename', documentId: 'document-1',
    origin: 'ui',
    contract: schemaContract,
    parameters: { layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Title' },
    outcome: 'completed', result: { layerId: 'old-layer', name: 'Title' }, startedAt: 2, durationMs: 1,
    replayable: true, note: null, rationale: null
  }, {
    sequence: 3, requestId: 'recorded-3', command: 'history.undo', documentId: 'document-1',
    origin: 'ui',
    contract: schemaContract,
    parameters: {}, outcome: 'completed', result: { changed: true, documentChanged: true }, startedAt: 2, durationMs: 1,
    replayable: false, note: 'diagnostic', rationale: null
  }]
});

describe('SemanticActionPlaybackController', () => {
  const atomicRecording = (): ActionRecordingSnapshot => ({
    ...recording(), name: 'Atomic title', steps: [{
      ...recording().steps[0]!, command: 'text.create', parameters: {
        mode: 'point', text: 'Title', origin: { x: 20, y: 30 }
      }, result: { layerId: 'recorded-title' }
    }, {
      ...recording().steps[1]!, command: 'layer.rename', parameters: {
        layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Hero title'
      }, result: { layerId: 'recorded-title', name: 'Hero title' }
    }]
  });

  it('plays replayable steps through the supplied semantic executor', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'layer.createRaster'
        ? { created: true, layerId: 'new-layer-for-this-run' } : {},
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

  it('skips disabled steps and pauses interactive steps for edited parameters', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const, value: { created: true, layerId: 'new-layer' },
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);
    const interactive: ActionRecordingSnapshot = { ...recording(), steps: [
      { ...recording().steps[0]!, enabled: false },
      { ...recording().steps[1]!, sequence: 2, interactive: true,
        parameters: { layerId: 'existing-layer', name: 'Recorded' } }
    ] };

    const playing = controller.play(interactive);
    await vi.waitFor(() => expect(controller.snapshot().prompt?.sequence).toBe(2));
    controller.continueInteractive({ layerId: 'existing-layer', name: 'Changed' });
    await playing;

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'layer.rename', parameters: { layerId: 'existing-layer', name: 'Changed' }
    }));
    expect(controller.snapshot()).toMatchObject({ status: 'completed', prompt: null });
  });

  it('retargets every document-scoped step to the current active document', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'layer.createRaster'
        ? { created: true, layerId: 'fresh-layer' } : {},
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(recording(), 'fresh-document');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([request]) => request.documentId === 'fresh-document')).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parameters: { layerId: 'fresh-layer', name: 'Title' }
    }));
  });

  it('routes steps recorded after workspace document creation to the newly replayed document', async () => {
    const createdRecording: ActionRecordingSnapshot = { ...recording(), steps: [{
      ...recording().steps[0]!, command: 'document.create', documentId: null,
      parameters: { name: 'Created', width: 640, height: 480, resolutionPpi: 72, bitDepth: 8,
        profile: 'srgb', background: { kind: 'transparent' } },
      result: { documentId: 'recorded-created-document' }
    }, {
      ...recording().steps[1]!, command: 'layer.createRaster', documentId: 'recorded-created-document',
      parameters: {}, result: { created: true, layerId: 'old-layer' }
    }] };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'document.create'
        ? { documentId: 'fresh-created-document' }
        : { created: true, layerId: 'fresh-layer' },
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(createdRecording, 'preexisting-target');

    expect(execute).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ documentId: expect.anything() }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.createRaster', documentId: 'fresh-created-document'
    }));
    expect(controller.snapshot().status).toBe('completed');
  });

  it('routes steps recorded after a source-scoped duplicate to the fresh fork', async () => {
    const duplicateRecording: ActionRecordingSnapshot = { ...recording(), steps: [{
      ...recording().steps[0]!, command: 'document.duplicate', documentId: 'recorded-source',
      parameters: { name: 'Variant A' }, result: { documentId: 'recorded-duplicate' }
    }, {
      ...recording().steps[1]!, command: 'layer.createRaster', documentId: 'recorded-duplicate',
      parameters: {}, result: { created: true, layerId: 'old-layer' }
    }] };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'document.duplicate'
        ? { documentId: 'fresh-duplicate' }
        : { created: true, layerId: 'fresh-layer' },
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(duplicateRecording, 'fresh-source');

    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'document.duplicate', documentId: 'fresh-source'
    }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.createRaster', documentId: 'fresh-duplicate'
    }));
    expect(controller.snapshot().status).toBe('completed');
  });

  it('plays one step with its transitive result producers but skips unrelated later work', async () => {
    const dependent: ActionRecordingSnapshot = { ...recording(), steps: [
      { ...recording().steps[0]! },
      { ...recording().steps[1]! },
      { ...recording().steps[1]!, sequence: 3, requestId: 'recorded-3',
        parameters: { layerId: 'unrelated-layer', name: 'Later' },
        result: { layerId: 'unrelated-layer', name: 'Later' } }
    ] };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'layer.createRaster'
        ? { created: true, layerId: 'fresh-layer' }
        : { layerId: 'fresh-layer', name: 'Title' },
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.playStep(dependent, 2, 'fresh-document');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ command: 'layer.createRaster' }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'layer.rename', parameters: { layerId: 'fresh-layer', name: 'Title' }
    }));
    expect(controller.snapshot().results.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it('plays from a forked-document step with the document producer and all later steps', async () => {
    const forked: ActionRecordingSnapshot = { ...recording(), steps: [{
      ...recording().steps[0]!, command: 'document.duplicate', documentId: 'recorded-source',
      parameters: { name: 'Variant' }, result: { documentId: 'recorded-duplicate' }
    }, {
      ...recording().steps[1]!, command: 'layer.createRaster', documentId: 'recorded-duplicate',
      parameters: {}, result: { created: true, layerId: 'old-layer' }
    }, {
      ...recording().steps[1]!, sequence: 3, requestId: 'recorded-3',
      documentId: 'recorded-duplicate', parameters: {
        layerId: { $lighttableResult: { step: 2, path: 'layerId' } }, name: 'Variant paint'
      }, result: { layerId: 'old-layer', name: 'Variant paint' }
    }] };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const,
      value: request.command === 'document.duplicate' ? { documentId: 'fresh-duplicate' }
        : request.command === 'layer.createRaster' ? { created: true, layerId: 'fresh-layer' }
          : { layerId: 'fresh-layer', name: 'Variant paint' },
      revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.playFrom(forked, 2, 'fresh-source');

    expect(execute.mock.calls.map(([request]) => request.command))
      .toEqual(['document.duplicate', 'layer.createRaster', 'layer.rename']);
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ documentId: 'fresh-duplicate' }));
    expect(execute).toHaveBeenNthCalledWith(3, expect.objectContaining({
      documentId: 'fresh-duplicate', parameters: { layerId: 'fresh-layer', name: 'Variant paint' }
    }));
  });

  it('awaits an accepted task and binds its artifact into the following step', async () => {
    const asyncRecording: ActionRecordingSnapshot = {
      ...recording(), steps: [{ ...recording().steps[0]!, command: 'file.exportNative',
        contract: legacyContract,
        outcome: 'accepted', result: { taskId: 'old-task', artifact: { id: 'old-artifact' } },
      parameters: {} }, { ...recording().steps[1]!, command: 'file.openArtifact',
        contract: legacyContract, documentId: null, result: { documentId: 'opened-document' }, parameters: {
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
      ...recording(), steps: [acceptedBatchStep(),
      { ...recording().steps[1]!, contract: schemaContract,
        parameters: { layerId: 'old-layer', name: 'Later' } }]
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
      ...recording(), steps: [acceptedBatchStep(),
      { ...recording().steps[1]!, contract: schemaContract,
        parameters: { layerId: 'old-layer', name: 'Later' } }]
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

  it('fails contract preflight before executing a future-schema Action', async () => {
    const execute = vi.fn();
    const incompatible: ActionRecordingSnapshot = { ...recording(), steps: [
      { ...recording().steps[0]! },
      { ...recording().steps[1]!, contract: { status: 'complete', schemaVersion: 2 } }
    ] };
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(incompatible);

    expect(execute).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ status: 'failed', currentSequence: 2,
      results: [{ status: 'contract-incompatible', message: expect.stringMatching(/schema v2/i) }] });
  });

  it('replays typed variable defaults and explicit overrides through the same command route', async () => {
    const variableRecording: ActionRecordingSnapshot = {
      ...recording(),
      variables: [{ name: 'layerName', type: 'string', defaultValue: 'Default title' }],
      steps: [{ ...recording().steps[1]!, parameters: {
        layerId: 'existing-layer', name: { $lighttableVariable: { name: 'layerName' } }
      } }]
    };
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'completed' as const, value: { layerId: 'existing-layer',
        name: (request.parameters as { name: string }).name }, revisions: { workspace: 1 } }));
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(variableRecording, 'document-2', { layerName: 'Agent title' });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'document-2', parameters: { layerId: 'existing-layer', name: 'Agent title' }
    }));
  });

  it('rejects invalid variable overrides before executing any step', async () => {
    const variableRecording: ActionRecordingSnapshot = {
      ...recording(),
      variables: [{ name: 'layerName', type: 'string', defaultValue: 'Default title' }],
      steps: [{ ...recording().steps[1]!, parameters: {
        layerId: 'existing-layer', name: { $lighttableVariable: { name: 'layerName' } }
      } }]
    };
    const execute = vi.fn();
    const controller = new SemanticActionPlaybackController(execute);

    await controller.play(variableRecording, 'document-2', { layerName: 42 });

    expect(execute).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ status: 'failed', currentSequence: 0,
      results: [{ status: 'binding-error', message: expect.stringMatching(/requires a string/i) }] });
  });

  it('honors an explicitly authored result dependency when playing only its consumer step', async () => {
    const recorder = new SemanticActionRecorder();
    recorder.start('Explicit dependency');
    recorder.record({ protocolVersion: 1, requestId: 'create', command: 'layer.createRaster',
      documentId: 'document-1', parameters: {} }, {
      requestId: 'create', status: 'completed', value: { created: true, layerId: 'old-layer' },
      revisions: { workspace: 1, document: 2 }
    }, Date.now());
    recorder.record({ protocolVersion: 1, requestId: 'rename', command: 'layer.rename',
      documentId: 'document-1', parameters: { layerId: 'old-layer', name: 'Title' } }, {
      requestId: 'rename', status: 'completed', value: { layerId: 'old-layer', name: 'Title' },
      revisions: { workspace: 1, document: 3 }
    }, Date.now());
    recorder.stop();
    expect(recorder.restoreLiteral(2, '/layerId')).toEqual({ ok: true });
    expect(recorder.bindResult(2, '/layerId', 1, 'layerId')).toEqual({ ok: true });
    const execute = vi.fn(async (request) => request.command === 'layer.createRaster'
      ? { requestId: request.requestId, status: 'completed' as const,
        value: { created: true, layerId: 'new-layer' }, revisions: { workspace: 1, document: 4 } }
      : { requestId: request.requestId, status: 'completed' as const,
        value: { layerId: (request.parameters as { layerId: string }).layerId, name: 'Title' },
        revisions: { workspace: 1, document: 5 } });
    const controller = new SemanticActionPlaybackController(execute);

    await controller.playStep(recorder.snapshot(), 2, 'document-2');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toMatchObject({ command: 'layer.rename',
      parameters: { layerId: 'new-layer', name: 'Title' } });
  });

  it('plays an eligible Action through one accepted atomic batch and preserves per-step results', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'accepted' as const, taskId: 'batch-task', revisions: { workspace: 1, document: 2 } }));
    const wait = vi.fn(async () => ({ status: 'completed' as const,
      value: { progress: 1, artifact: null } }));
    const controller = new SemanticActionPlaybackController(execute, { wait });

    await controller.playAtomic(atomicRecording(), 'fresh-document');

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'command.batch', documentId: 'fresh-document', parameters: expect.objectContaining({
        name: 'Atomic title', operations: [expect.objectContaining({ command: 'text.create' }),
          expect.objectContaining({ command: 'layer.rename', parameters: {
            layerId: { resultOf: 'step-1', field: 'layerId' }, name: 'Hero title'
          } })]
      })
    }));
    expect(wait).toHaveBeenCalledWith('fresh-document', 'batch-task', expect.any(AbortSignal), expect.any(Function));
    expect(controller.snapshot()).toMatchObject({ status: 'completed',
      results: [{ sequence: 1, command: 'text.create', status: 'completed' },
        { sequence: 2, command: 'layer.rename', status: 'completed' }] });
  });

  it('rejects ineligible atomic playback before executing a partial workflow', async () => {
    const execute = vi.fn();
    const controller = new SemanticActionPlaybackController(execute);

    await controller.playAtomic(recording(), 'fresh-document');

    expect(execute).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ status: 'failed', currentSequence: 0,
      results: [{ command: 'command.batch', status: 'atomic-incompatible',
        message: expect.stringMatching(/diagnostic|cannot publish/i) }] });
  });

  it('cancels an in-flight atomic batch before it can publish', async () => {
    const execute = vi.fn(async (request) => ({ requestId: request.requestId,
      status: 'accepted' as const, taskId: 'batch-task', revisions: { workspace: 1 } }));
    const canceled = vi.fn();
    const controller = new SemanticActionPlaybackController(execute, { wait: (
      _documentId, _taskId, signal
    ) => new Promise((resolve) => signal.addEventListener('abort', () => {
      canceled(); resolve({ status: 'canceled', message: 'Stopped.' });
    }, { once: true })) });

    const playing = controller.playAtomic(atomicRecording(), 'fresh-document');
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('running'));
    controller.stop();
    await playing;

    expect(canceled).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({ status: 'stopped', currentSequence: null });
  });
});
