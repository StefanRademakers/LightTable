import { describe, expect, it, vi } from 'vitest';
import { createAnchor, createSubpath, createVectorPath, type VectorPath } from '@lighttable/vector-core';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { TextToShapeCommandController } from './TextToShapeCommandController';

const path = () => createVectorPath('glyph', 'Glyph', [createSubpath('contour', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 10, y: 20 }),
  createAnchor('c', { x: 20, y: 0 })
], true)]);

const harness = () => {
  let document = createTextLayer(
    createImageDocument('Convert', 100, 50, 'asset'),
    createDefaultTextLayerData(),
    'Editable'
  );
  const opening = document;
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const resolveVectorPaths = vi.fn(async (
    _layerId: LayerId,
    _signal: AbortSignal
  ): Promise<readonly VectorPath[] | null> => [path()]);
  const controller = new TextToShapeCommandController(() => ({
    getDocument: () => document,
    applyDocument: (next) => { document = next; },
    pushDocumentHistory: (before, after) => history.push({ before, after }),
    resolveVectorPaths
  }));
  return {
    controller, opening, history, resolveVectorPaths,
    document: () => document,
    replaceDocument: (next: typeof document) => { document = next; }
  };
};

describe('TextToShapeCommandController', () => {
  it('publishes one atomic history snapshot and retains the exact editable TextLayer for undo', async () => {
    const state = harness();
    const layerId = state.opening.activeLayerId!;
    const originalLayer = findDocumentLayer(state.opening, layerId);

    await expect(state.controller.convert(layerId)).resolves.toBe(true);

    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.before).toBe(state.opening);
    expect(state.history[0]?.after).toBe(state.document());
    expect(findDocumentLayer(state.document(), layerId)?.type).toBe('vector');
    expect(findDocumentLayer(state.history[0]!.before, layerId)).toBe(originalLayer);
    state.replaceDocument(state.history[0]!.before);
    expect(findDocumentLayer(state.document(), layerId)).toBe(originalLayer);
    state.replaceDocument(state.history[0]!.after);
    expect(findDocumentLayer(state.document(), layerId)?.type).toBe('vector');
  });

  it('does not publish stale conversion work after the active snapshot changes', async () => {
    const state = harness();
    let resolve!: (paths: readonly VectorPath[] | null) => void;
    state.resolveVectorPaths.mockImplementationOnce(() => new Promise<readonly VectorPath[] | null>(
      (complete) => { resolve = complete; }
    ));
    const pending = state.controller.convert(state.opening.activeLayerId!);
    const replacement = createImageDocument('Other', 10, 10, 'other');
    state.replaceDocument(replacement);
    resolve([path()]);

    await expect(pending).resolves.toBe(false);
    expect(state.document()).toBe(replacement);
    expect(state.history).toHaveLength(0);
  });

  it('allows only one conversion at a time and cancellation never creates history', async () => {
    const state = harness();
    let reject!: (reason?: unknown) => void;
    state.resolveVectorPaths.mockImplementationOnce((_layerId, signal) => new Promise<readonly VectorPath[] | null>((_resolve, fail) => {
      reject = fail;
      signal.addEventListener('abort', () => fail(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const pending = state.controller.convert(state.opening.activeLayerId!);
    await expect(state.controller.convert(state.opening.activeLayerId!)).resolves.toBe(false);
    expect(state.controller.cancel()).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.history).toHaveLength(0);
    expect(state.document()).toBe(state.opening);
    expect(reject).toBeTypeOf('function');
  });
});
