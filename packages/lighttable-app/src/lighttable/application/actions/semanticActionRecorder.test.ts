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
      contract: { status: 'complete', schemaVersion: 1 },
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

  it('promotes a parameter to a typed variable and validates later edits atomically', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start('Reusable rename');
    recorder.record(request('layer.rename', { layerId: 'layer-1', name: 'Title' }),
      completed('request-layer.rename', { layerId: 'layer-1', name: 'Title' }), Date.now());
    recorder.stop();

    expect(recorder.createVariable(1, '/name', 'layerName')).toEqual({ ok: true });
    expect(recorder.snapshot().variables).toEqual([
      { name: 'layerName', type: 'string', defaultValue: 'Title' }
    ]);
    expect(recorder.snapshot().steps[0]?.parameters).toMatchObject({
      name: { $lighttableVariable: { name: 'layerName' } }
    });
    expect(recorder.updateVariable('layerName', 42)).toMatchObject({ ok: false });
    expect(recorder.snapshot().variables[0]?.defaultValue).toBe('Title');
    expect(recorder.updateVariable('layerName', 'Subtitle')).toEqual({ ok: true });
    expect(recorder.deleteVariable('layerName')).toEqual({ ok: true });
    expect(recorder.snapshot().steps[0]?.parameters).toMatchObject({ name: 'Subtitle' });
  });

  it('supports explicit prior-result binding and rejects forward references', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('layer.createRaster'),
      completed('request-layer.createRaster', { created: true, layerId: 'created-layer' }), Date.now());
    recorder.record(request('layer.rename', { layerId: 'created-layer', name: 'Title' }),
      completed('request-layer.rename', { layerId: 'created-layer', name: 'Title' }), Date.now());
    recorder.stop();
    expect(recorder.restoreLiteral(2, '/layerId')).toEqual({ ok: true });
    expect(recorder.bindResult(2, '/layerId', 1, 'layerId')).toEqual({ ok: true });
    expect(recorder.bindResult(1, '/name', 2, 'name')).toMatchObject({ ok: false });
  });

  it('replaces complete-schema step parameters atomically', () => {
    const recorder = new SemanticActionRecorder();
    recorder.start();
    recorder.record(request('layer.rename', { layerId: 'layer-1', name: 'Title' }),
      completed('request-layer.rename', { layerId: 'layer-1', name: 'Title' }), Date.now());
    recorder.stop();

    expect(recorder.replaceParameters(1, { layerId: 'layer-1', name: 'Edited title' }))
      .toEqual({ ok: true });
    expect(recorder.snapshot().steps[0]?.parameters).toMatchObject({ name: 'Edited title' });
    expect(recorder.replaceParameters(1, { layerId: 'layer-1' })).toMatchObject({ ok: false });
    expect(recorder.snapshot().steps[0]?.parameters).toMatchObject({ name: 'Edited title' });
  });
});
