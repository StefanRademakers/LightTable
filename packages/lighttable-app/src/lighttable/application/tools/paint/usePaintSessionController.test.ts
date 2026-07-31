import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { createEditorSession } from '../../../editor/session/editorSession';
import { identityMatrix } from '../../../editor/tools/transform/affine';
import {
  createPaintSessionController,
  type PaintSessionDependencies,
  type PaintSessionRendererPort
} from './usePaintSessionController';

const createPixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

const createFixture = () => {
  let document = createImageDocument('Paint', 100, 80, 'asset');
  const layer = document.layers[0] as RasterLayer;
  const pixelEdit = createPixelEdit();
  const renderer: PaintSessionRendererPort = {
    beginBrushStroke: vi.fn(),
    paintBrushDabs: vi.fn(),
    finishPixelEdit: vi.fn(() => pixelEdit),
    cancelPixelEdit: vi.fn(),
    applyPixelHistory: vi.fn(() => true)
  };
  const history: Array<Parameters<PaintSessionDependencies['pushHistoryEntry']>[0]> = [];
  const dependencies: PaintSessionDependencies = {
    getDocument: () => document,
    getRenderer: () => renderer,
    applyDocumentSnapshot: vi.fn((next) => {
      document = next;
    }),
    pushHistoryEntry: (entry) => history.push(entry),
    setError: vi.fn()
  };
  return {
    controller: createPaintSessionController(() => dependencies),
    dependencies,
    history,
    layer,
    pixelEdit,
    renderer,
    getDocument: () => document
  };
};

describe('PaintSessionController', () => {
  it('locks brush settings and commits one document/history transaction', () => {
    const fixture = createFixture();
    const brush = createEditorSession().brush;
    expect(fixture.controller.begin({
      pointerId: 4,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush,
      point: { x: 10, y: 10, pressure: 1 }
    })).toBe(true);
    brush.color = '#ffffff';
    fixture.controller.move(4, { x: 20, y: 10, pressure: 1 });
    expect(fixture.controller.finish(4)).toBe(true);

    expect(fixture.renderer.paintBrushDabs).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fixture.renderer.paintBrushDabs).mock.calls[1]?.[3]).toEqual([0, 0, 0]);
    expect((fixture.getDocument().layers[0] as RasterLayer).pixelRevision).toBe(1);
    expect(fixture.history).toHaveLength(1);

    fixture.history[0]?.undo();
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'undo'
    );
    fixture.history[0]?.redo();
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'redo'
    );
  });

  it('rolls a cancelled gesture back without publishing document history', () => {
    const fixture = createFixture();
    fixture.controller.begin({
      pointerId: 8,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: true,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 5, y: 5, pressure: 1 }
    });
    expect(fixture.controller.cancel(8)).toBe(true);
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'undo'
    );
    expect(fixture.pixelEdit.destroy).toHaveBeenCalledOnce();
    expect(fixture.history).toHaveLength(0);
  });
});
