import { describe, expect, it, vi } from 'vitest';
import { SemanticActionRecorder } from './semanticActionRecorder';

const request = (command: string, parameters: unknown = {}) => ({
  protocolVersion: 1, requestId: `request-${command}`, command, documentId: 'document-1', parameters
});
const completed = (requestId: string, value: unknown = {}) => ({
  requestId, status: 'completed' as const, value, revisions: { workspace: 1, document: 2 }
});

describe('SemanticActionRecorder', () => {
  it('records completed semantic commands with transport-safe parameters and results', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(107);
    const recorder = new SemanticActionRecorder();
    recorder.start('Build card');
    recorder.record(request('layer.rename', { layerId: 'layer-1', name: 'Title' }),
      completed('request-layer.rename', { layerId: 'layer-1' }), 101);
    recorder.stop();

    expect(recorder.snapshot()).toMatchObject({ status: 'stopped', name: 'Build card' });
    expect(recorder.snapshot().byteLength).toBeGreaterThan(0);
    expect(recorder.snapshot().steps).toEqual([expect.objectContaining({
      sequence: 1, command: 'layer.rename', origin: 'ui', outcome: 'completed', replayable: true,
      parameters: { layerId: 'layer-1', name: 'Title' }, durationMs: 6
    })]);
    vi.restoreAllMocks();
  });

  it('retains trusted execution origin for debugging', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('layer.rename', { layerId: 'layer-1', name: 'Agent title' }),
      completed('request-layer.rename'), Date.now(), recorder.snapshot().id, 'mcp');

    expect(recorder.snapshot().steps[0]?.origin).toBe('mcp');
  });

  it('keeps rejected and history commands visible without making them replayable', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('history.undo'), completed('request-history.undo'), Date.now());
    recorder.record(request('layer.rename'), {
      requestId: 'request-layer.rename', status: 'rejected', code: 'invalid-parameters',
      message: 'Rename requires a layer.', revisions: { workspace: 1 }
    }, Date.now());

    expect(recorder.snapshot().steps.map(({ replayable, note }) => ({ replayable, note }))).toEqual([
      { replayable: false, note: 'Control/history commands are diagnostic only.' },
      { replayable: false, note: 'Rejected commands are retained for debugging but are not replayable.' }
    ]);
  });

  it('binds later stable-ID parameters to earlier command results', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('layer.createRaster'),
      completed('request-layer.createRaster', { layerId: 'recorded-layer-id' }), Date.now());
    recorder.record(request('layer.rename', { layerId: 'recorded-layer-id', name: 'Title' }),
      completed('request-layer.rename', { layerId: 'recorded-layer-id', name: 'Title' }), Date.now());

    expect(recorder.snapshot().steps[1]?.parameters).toEqual({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } },
      name: 'Title'
    });
  });

  it('enriches an accepted task result so later artifact parameters bind', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('file.exportNative'), {
      requestId: 'request-file.exportNative', status: 'accepted', taskId: 'task-1',
      revisions: { workspace: 1 }
    }, Date.now());
    expect(recorder.snapshot().steps[0]).toMatchObject({ outcome: 'accepted', replayable: true });
    expect(recorder.completeTask('task-1', { artifact: { id: 'artifact-1' } })).toBe(true);
    recorder.record(request('file.openArtifact', { artifactId: 'artifact-1' }),
      completed('request-file.openArtifact'), Date.now());

    expect(recorder.snapshot().steps[1]?.parameters).toEqual({
      artifactId: { $lighttableResult: { step: 1, path: 'artifact.id' } }
    });
  });
});
