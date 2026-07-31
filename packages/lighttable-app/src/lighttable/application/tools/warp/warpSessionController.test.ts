import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import type { ImageDocument } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import {
  createAdjustmentStackFromBasicAdjustments
} from '../../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../../types';
import {
  findWarpModuleInstance,
  readWarpNodeSettings
} from '../../../effects/warp/warpTypes';
import { createWarpSessionController } from './warpSessionController';
import { createWarpPreviewScheduler } from './warpPreviewScheduler';

const brush = {
  diameterPx: 120,
  strength: 0.5,
  hardness: 0.6,
  flow: 1,
  spacing: 0.1,
  pressureSize: true,
  pressureStrength: true
};

const point = (x: number, y: number, timeMs: number) => ({
  x,
  y,
  pressure: 1,
  timeMs
});

const harness = () => {
  const base = createImageDocument('Warp', 200, 100, 'source');
  const background = findRasterLayer(base, base.activeLayerId)!;
  const originalStack = createAdjustmentStackFromBasicAdjustments(
    createDefaultAdjustments()
  );
  const layer = {
    ...background,
    transform: { a: 0, b: 2, c: -2, d: 0, tx: 100, ty: 20 },
    adjustmentStack: originalStack
  };
  let document: ImageDocument = {
    ...base,
    layers: [layer]
  };
  const history: Array<{ undo(): void; redo(): void }> = [];
  let id = 0;
  const dependencies = {
    getDocument: () => document,
    applyDocumentSnapshot: vi.fn((next) => {
      document = next;
    }),
    pushHistoryEntry: vi.fn((entry) => history.push(entry)),
    setError: vi.fn(),
    createId: vi.fn((kind: string) => `${kind}-${++id}`)
  };
  return {
    dependencies,
    history,
    originalStack,
    get document() {
      return document;
    },
    set document(next) {
      document = next;
    }
  };
};

describe('Warp session controller', () => {
  it('authors transformed input in layer-source pixels and commits one history entry', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);

    expect(controller.begin({
      pointerId: 7,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.move(7, point(60, 60, 20))).toBe(true);
    expect(controller.move(7, point(40, 80, 30))).toBe(true);
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
    expect(controller.finish(7, 40)).toBe(true);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);

    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    expect(settings.strokes).toHaveLength(1);
    expect(settings.strokes[0]?.samples.map(({ positionPx }) => positionPx)).toEqual([
      [10, 10],
      [20, 20],
      [30, 30]
    ]);
    expect(layer.adjustmentStack?.modules.length).toBeGreaterThan(1);
    expect(layer.adjustmentStack?.modules.filter(({ type }) => type !== 'lt.warp'))
      .toEqual(state.originalStack.modules);

    state.history[0]?.undo();
    expect(findWarpModuleInstance(
      findRasterLayer(state.document, state.document.activeLayerId)?.adjustmentStack
    )).toBeNull();
    state.history[0]?.redo();
    expect(findWarpModuleInstance(
      findRasterLayer(state.document, state.document.activeLayerId)?.adjustmentStack
    )).not.toBeNull();
  });

  it('restores the exact document when a gesture is cancelled or never moves', () => {
    const state = harness();
    const before = state.document;
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 2,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.cancel(2)).toBe(true);
    expect(state.document).toBe(before);

    expect(controller.begin({
      pointerId: 3,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.finish(3, 20)).toBe(true);
    expect(state.document).toBe(before);
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
  });

  it('cannot publish a gesture after the active document changes', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 4,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    state.document = createImageDocument('Other', 10, 10, 'other');
    expect(controller.move(4, point(60, 60, 20))).toBe(false);
    expect(controller.active).toBe(false);
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
  });

  it('coalesces previews while preserving every authored sample at commit', () => {
    const state = harness();
    let frameCallback: (() => void) | null = null;
    const scheduler = createWarpPreviewScheduler({
      request: (callback) => {
        frameCallback = callback;
        return 1;
      },
      cancel: vi.fn()
    });
    const controller = createWarpSessionController(
      () => state.dependencies,
      undefined,
      scheduler
    );
    expect(controller.begin({
      pointerId: 8,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    const publicationsAfterBegin = state.dependencies.applyDocumentSnapshot.mock.calls.length;

    expect(controller.move(8, point(60, 60, 20))).toBe(true);
    expect(controller.move(8, point(40, 80, 30))).toBe(true);
    expect(state.dependencies.applyDocumentSnapshot).toHaveBeenCalledTimes(publicationsAfterBegin);

    (frameCallback as (() => void) | null)?.();
    expect(state.dependencies.applyDocumentSnapshot)
      .toHaveBeenCalledTimes(publicationsAfterBegin + 1);

    expect(controller.move(8, point(20, 100, 40))).toBe(true);
    expect(controller.finish(8, 50)).toBe(true);
    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    expect(settings.strokes[0]?.samples).toHaveLength(4);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);
  });
});
