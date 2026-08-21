import { describe, expect, it, vi } from 'vitest';
import { LIGHTTABLE_COMMAND_SCHEMAS, validateJsonSchemaValue } from '@lighttable/command-contract';
import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer, createTextLayer } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { executeAtomicCommandBatch } from './atomicCommandBatchExecutor';
import type { AtomicCommandBatch } from './atomicCommandBatchContract';

const fixture = () => {
  let document = createRasterLayer(
    createRasterLayer(createImageDocument('Batch', 64, 64, 'source'), 'Bottom'),
    'Top'
  );
  const layerId = document.activeLayerId!;
  const publish = vi.fn((next) => { document = next; });
  const record = vi.fn();
  const dependencies = { fontRegistry: {} as never, getDocument: () => document,
    getTextSettings: () => ({}) as never, getForegroundColor: () => '#000000', publish, record };
  return { get document() { return document; }, layerId, publish, record, dependencies };
};
const batch = (operations: AtomicCommandBatch['operations']): AtomicCommandBatch => ({
  name: 'Agent: build card', timeoutMs: 5000, operations
});

describe('executeAtomicCommandBatch', () => {
  it('publishes once and records one named undo boundary', async () => {
    const state = fixture();
    const progress = vi.fn();
    const result = await executeAtomicCommandBatch(batch([
      { operationId: 'rename', command: 'layer.rename', parameters: { layerId: state.layerId, name: 'Hero' } },
      { operationId: 'dim', command: 'layer.setFillOpacity', parameters: { layerId: state.layerId, opacity: 0.5 } }
    ]), state.dependencies, new AbortController().signal, progress);
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.record).toHaveBeenCalledOnce();
    expect(state.record.mock.calls[0][2]).toBe('Agent: build card');
    expect(findDocumentLayer(state.document, state.layerId)).toMatchObject({ name: 'Hero', fillOpacity: 0.5 });
    expect(progress).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { operationId: 'rename', value: { layerId: state.layerId, name: 'Hero' } },
      { operationId: 'dim', value: { layerId: state.layerId, opacity: 0.5 } }
    ]);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.rename']!.result,
      result.results[0]!.value).valid).toBe(true);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.setFillOpacity']!.result,
      result.results[1]!.value).valid).toBe(true);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['command.batch']!.result,
      result).valid).toBe(true);
  });

  it('resolves deterministic operation-result references inside the batch', async () => {
    const state = fixture();
    const referencedBatch = batch([
      { operationId: 'shape', command: 'vector.create', parameters: {
        name: 'Card', primitive: { kind: 'rectangle', x: 4, y: 4, width: 40, height: 24 }
      } },
      { operationId: 'rename-shape', command: 'layer.rename', parameters: {
        layerId: { resultOf: 'shape', field: 'layerId' }, name: 'Agent card'
      } }
    ]);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['command.batch']!.input,
      referencedBatch).valid).toBe(true);
    const result = await executeAtomicCommandBatch(referencedBatch,
      state.dependencies, new AbortController().signal, () => undefined);
    expect(result.results.map(({ operationId }) => operationId)).toEqual(['shape', 'rename-shape']);
    const shapeResult = result.results[0].value as { layerId: string };
    expect(findDocumentLayer(state.document, shapeResult.layerId as never)?.name).toBe('Agent card');
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('maps text.replaceRange to the semantic replace command inside a batch', async () => {
    const state = fixture();
    const textDocument = createTextLayer(state.document, {
      ...createDefaultTextLayerData(), source: createDefaultFlowTextSource('Before')
    }, 'Copy');
    state.dependencies.publish(textDocument);
    state.publish.mockClear();
    state.record.mockClear();
    const textLayerId = textDocument.activeLayerId!;

    const result = await executeAtomicCommandBatch(batch([
      { operationId: 'replace-copy', command: 'text.replaceRange', parameters: {
        layerId: textLayerId, start: 0, end: 6, text: 'After'
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined);

    expect(result.results).toEqual([
      { operationId: 'replace-copy', value: { layerId: textLayerId } }
    ]);
    expect(findDocumentLayer(state.document, textLayerId)).toMatchObject({
      type: 'text', text: { source: { kind: 'flow', text: 'After' } }
    });
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.record).toHaveBeenCalledOnce();
  });

  it('rejects unavailable or forward result references without publication', async () => {
    const state = fixture();
    await expect(executeAtomicCommandBatch(batch([
      { operationId: 'rename', command: 'layer.rename', parameters: {
        layerId: { resultOf: 'later', field: 'layerId' }, name: 'Never visible'
      } },
      { operationId: 'later', command: 'vector.create', parameters: {
        name: 'Later', primitive: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20 }
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined))
      .rejects.toThrow(/later\.layerId is unavailable/u);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it('applies structural layer properties as one atomic history publication', async () => {
    const state = fixture();
    const result = await executeAtomicCommandBatch(batch([
      { operationId: 'blend', command: 'layer.setBlendMode', parameters: {
        layerId: state.layerId, blendMode: 'multiply'
      } },
      { operationId: 'lock', command: 'layer.setLock', parameters: {
        layerIds: [state.layerId], lock: 'position', locked: true
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined);
    expect(findDocumentLayer(state.document, state.layerId)).toMatchObject({
      blendMode: 'multiply', locks: { position: true }
    });
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.record).toHaveBeenCalledOnce();
    expect(result.results).toEqual([
      { operationId: 'blend', value: { layerId: state.layerId, blendMode: 'multiply' } },
      { operationId: 'lock', value: { layerIds: [state.layerId], lock: 'position', locked: true } }
    ]);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.setBlendMode']!.result,
      result.results[0]!.value).valid).toBe(true);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.setLock']!.result,
      result.results[1]!.value).valid).toBe(true);
  });

  it('returns the same move and clipping result shape as direct execution', async () => {
    const state = fixture();
    const result = await executeAtomicCommandBatch(batch([
      { operationId: 'clip', command: 'layer.setClipping', parameters: {
        layerId: state.layerId, clipping: true
      } },
      { operationId: 'move', command: 'layer.move', parameters: {
        layerId: state.layerId, direction: 'down'
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined);
    expect(result.results).toEqual([
      { operationId: 'clip', value: { layerId: state.layerId, clipping: true } },
      { operationId: 'move', value: { layerId: state.layerId, direction: 'down' } }
    ]);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.setClipping']!.result,
      result.results[0]!.value).valid).toBe(true);
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.move']!.result,
      result.results[1]!.value).valid).toBe(true);
  });

  it('keeps the exact baseline unpublished when any operation fails or is canceled', async () => {
    const state = fixture();
    await expect(executeAtomicCommandBatch(batch([
      { operationId: 'rename', command: 'layer.rename', parameters: { layerId: state.layerId, name: 'Never visible' } },
      { operationId: 'missing', command: 'layer.rename', parameters: { layerId: 'missing', name: 'Fail' } }
    ]), state.dependencies, new AbortController().signal, () => undefined)).rejects.toThrow('missing');
    expect(state.publish).not.toHaveBeenCalled();
    expect(findDocumentLayer(state.document, state.layerId)?.name).not.toBe('Never visible');

    const canceled = new AbortController(); canceled.abort();
    await expect(executeAtomicCommandBatch(batch([
      { operationId: 'rename', command: 'layer.rename', parameters: { layerId: state.layerId, name: 'Canceled' } }
    ]), state.dependencies, canceled.signal, () => undefined)).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('rejects shared-schema violations before publishing a partially applied batch', async () => {
    const state = fixture();
    await expect(executeAtomicCommandBatch(batch([
      { operationId: 'first', command: 'layer.rename', parameters: {
        layerId: state.layerId, name: 'Never published'
      } },
      { operationId: 'invalid', command: 'layer.setFillOpacity', parameters: {
        layerId: state.layerId, opacity: 0.5, rendererObject: {}
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined))
      .rejects.toThrow(/invalid.*schema v1/u);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(findDocumentLayer(state.document, state.layerId)?.name).not.toBe('Never published');
  });

  it('rejects conditional text-schema violations before publishing an atomic batch', async () => {
    const state = fixture();
    await expect(executeAtomicCommandBatch(batch([
      { operationId: 'rename', command: 'layer.rename', parameters: {
        layerId: state.layerId, name: 'Never published'
      } },
      { operationId: 'empty-format', command: 'text.format', parameters: {
        layerId: state.layerId, style: {}
      } }
    ]), state.dependencies, new AbortController().signal, () => undefined))
      .rejects.toThrow(/empty-format.*schema v1/u);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(findDocumentLayer(state.document, state.layerId)?.name).not.toBe('Never published');
  });

  it.each([0, 1, 2])('rolls back when command position %i fails', async (failureIndex) => {
    const state = fixture();
    const operations = ['First', 'Second', 'Third'].map((name, index) => ({
      operationId: `operation-${index}`, command: 'layer.rename' as const,
      parameters: { layerId: index === failureIndex ? 'missing' : state.layerId, name }
    }));
    await expect(executeAtomicCommandBatch(batch(operations), state.dependencies,
      new AbortController().signal, () => undefined)).rejects.toThrow(`operation-${failureIndex}`);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });
});
