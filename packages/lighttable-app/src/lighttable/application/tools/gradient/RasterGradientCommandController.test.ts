import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../../editor/document/documentTypes';
import { createEditorSession, type PaintChannel } from '../../../editor/session/editorSession';
import type { LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import { RasterGradientCommandController } from './RasterGradientCommandController';

const edit: ReversiblePixelEdit = {
  byteSize: 80,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
};

describe('RasterGradientCommandController', () => {
  it('commits one constrained gesture and publishes reversible history', () => {
    let document: ImageDocument = createImageDocument('Gradient', 64, 48, 'fixture');
    const before = document;
    const settings = { ...createEditorSession().gradient, application: 'pixels' as const };
    const history: Array<{ undo(): void; redo(): void }> = [];
    let capturedPaint: GradientPaintInstance | null = null;
    const renderer = {
      beginBrushStroke: vi.fn(),
      fillLayerColor: vi.fn(() => true),
      fillLayerGradient: vi.fn((
        _layerId: LayerId,
        _channel: PaintChannel,
        paint: GradientPaintInstance
      ) => {
        capturedPaint = paint;
        return true;
      }),
      finishPixelEdit: vi.fn(() => edit),
      cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document,
      getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      getSettings: () => settings,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => { document = next; }),
      pushHistoryEntry: vi.fn((entry: { undo(): void; redo(): void }) => history.push(entry)),
      setStatus: vi.fn(),
      setError: vi.fn(),
      onGradientCommitted: vi.fn()
    };
    const controller = new RasterGradientCommandController(() => dependencies);

    expect(controller.begin(7, { x: 4, y: 5 })).toBe(true);
    expect(controller.move(7, { x: 22, y: 18 })).toBe(true);
    expect(controller.finish(7, { x: 22, y: 18 }, true)).toBe(true);
    expect(renderer.fillLayerGradient).toHaveBeenCalledOnce();
    expect(capturedPaint).not.toBeNull();
    expect(capturedPaint!.transform.b).toBeCloseTo(capturedPaint!.transform.a);
    expect(history).toHaveLength(1);
    expect(dependencies.onGradientCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: before.activeLayerId, channel: 'pixels', opacity: 1 }),
      { layerId: before.activeLayerId, channel: 'pixels' }
    );

    history[0].undo();
    expect(document).toBe(before);
    history[0].redo();
    expect(document).not.toBe(before);
    expect(renderer.applyPixelHistory).toHaveBeenCalledTimes(2);
  });

  it('applies a final command directly without observing a second UI commit', () => {
    let document: ImageDocument = createImageDocument('Gradient command', 64, 48, 'fixture');
    const onGradientCommitted = vi.fn();
    const renderer = { beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      fillLayerGradient: vi.fn(() => true), finishPixelEdit: vi.fn(() => edit),
      cancelPixelEdit: vi.fn(), applyPixelHistory: vi.fn(() => true) };
    const dependencies = { getDocument: () => document, getRenderer: () => renderer,
      getChannel: () => 'mask' as const, getSettings: () => createEditorSession().gradient,
      applyDocumentSnapshot: (next: ImageDocument) => { document = next; },
      pushHistoryEntry: vi.fn(), setStatus: vi.fn(), setError: vi.fn(), onGradientCommitted };
    const controller = new RasterGradientCommandController(() => dependencies);
    const layerId = document.activeLayerId!;
    const paint = { ...createEditorSession().gradient.paint,
      transform: { a: 40, b: 0, c: 0, d: 40, tx: 2, ty: 3 } };
    expect(controller.apply({ layerId, channel: 'pixels', paint, opacity: 0.6,
      blendMode: 'multiply' })).toEqual({ layerId, channel: 'pixels' });
    expect(renderer.fillLayerGradient).toHaveBeenCalledWith(
      layerId, 'pixels', paint, 0.6, 'multiply', false
    );
    expect(onGradientCommitted).not.toHaveBeenCalled();
  });

  it('treats a click without a drag as a no-op', () => {
    const document = createImageDocument('Gradient', 64, 48, 'fixture');
    const dependencies = {
      getDocument: () => document,
      getRenderer: () => ({}) as never,
      getChannel: () => 'pixels' as const,
      getSettings: () => ({ ...createEditorSession().gradient, application: 'pixels' as const }),
      applyDocumentSnapshot: vi.fn(),
      pushHistoryEntry: vi.fn(),
      setStatus: vi.fn(),
      setError: vi.fn()
    };
    const controller = new RasterGradientCommandController(() => dependencies);
    expect(controller.begin(2, { x: 10, y: 10 })).toBe(true);
    expect(controller.finish(2, { x: 10, y: 10 }, false)).toBe(false);
    expect(dependencies.pushHistoryEntry).not.toHaveBeenCalled();
  });
});
