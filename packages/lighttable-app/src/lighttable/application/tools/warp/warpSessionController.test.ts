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
  MAX_INTERACTIVE_WARP_SAMPLES,
  readWarpNodeSettings
} from '../../../effects/warp/warpTypes';
import { createWarpSessionController } from './warpSessionController';
import { createWarpPreviewScheduler } from './warpPreviewScheduler';
import { createDocumentMutationController } from '../../documents/useDocumentMutationController';

const brush = {
  diameterPx: 120,
  strength: 0.5,
  hardness: 0.6,
  flow: 1,
  spacing: 0.1,
  smooth: 0,
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
  let projectedDocument = document;
  const history: Array<{ undo(): void; redo(): void }> = [];
  let id = 0;
  let interactionCurrent = true;
  const retireCanonicalProjection = vi.fn();
  const interactionBinding = {
    isCurrent: vi.fn(() => interactionCurrent),
    setActive: vi.fn(),
    requestCanonicalProjection: vi.fn(() => interactionCurrent
      ? { retire: retireCanonicalProjection }
      : null)
  };
  const getDocument = () => document;
  const previewDocumentSnapshot = vi.fn((next: ImageDocument) => {
      projectedDocument = next;
    });
  const discardDocumentPreview = vi.fn(() => {
      projectedDocument = document;
    });
  const applyDocumentSnapshot = vi.fn((next: ImageDocument) => {
      document = next;
      projectedDocument = next;
    });
  const pushHistoryEntry = vi.fn((entry: { undo(): void; redo(): void }) => history.push(entry));
  const documentMutations = createDocumentMutationController(() => ({
    getDocument,
    previewSnapshot: previewDocumentSnapshot,
    discardPreview: discardDocumentPreview,
    applySnapshot: applyDocumentSnapshot,
    pushHistoryEntry
  }));
  const dependencies = {
    getDocument,
    documentMutations,
    previewDocumentSnapshot,
    discardDocumentPreview,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError: vi.fn(),
    acquireInteractionBinding: vi.fn(() => interactionBinding),
    onStrokeCommitted: vi.fn(),
    createId: vi.fn((kind: string) => `${kind}-${++id}`)
  };
  return {
    dependencies,
    history,
    retireCanonicalProjection,
    originalStack,
    get document() {
      return document;
    },
    get projectedDocument() {
      return projectedDocument;
    },
    set document(next) {
      document = next;
      projectedDocument = next;
    },
    set interactionCurrent(current: boolean) {
      interactionCurrent = current;
    },
    interactionBinding
  };
};

describe('Warp session controller', () => {
  it('rejects declared modes that have no GPU executor before opening history', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 7,
      mode: 'smooth',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(false);
    expect(controller.active).toBe(false);
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'Warp mode "smooth" is not available yet.'
    );
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
  });

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
    expect(state.interactionBinding.setActive.mock.calls).toEqual([
      [true, expect.any(String)], [false, expect.any(String)]
    ]);

    const layer = findRasterLayer(
      state.projectedDocument,
      state.projectedDocument.activeLayerId
    )!;
    expect(state.dependencies.onStrokeCommitted).toHaveBeenCalledTimes(1);
    expect(state.dependencies.onStrokeCommitted).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({ mode: 'push', samples: expect.any(Array) }),
      expect.objectContaining({ layerId: layer.id, mode: 'push', samples: expect.any(Array) })
    );
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

  it('decimates long UI strokes into the exact Action and MCP boundary', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 7, mode: 'push', settings: brush, point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.moveMany(7, Array.from({ length: 6_000 }, (_, index) => (
      point(81 + index * 0.1, 40 + Math.sin(index / 20), 11 + index)
    )))).toBe(true);
    expect(controller.finish(7, 7_000)).toBe(true);
    const [, stroke, command] = state.dependencies.onStrokeCommitted.mock.calls[0]!;
    expect(stroke.samples.length).toBeLessThanOrEqual(MAX_INTERACTIVE_WARP_SAMPLES);
    expect(command.samples).toEqual(stroke.samples);
    expect(new TextEncoder().encode(JSON.stringify(command)).byteLength)
      .toBeLessThanOrEqual(240 * 1024);
    for (let index = 1; index < stroke.samples.length; index += 1) {
      const previous = stroke.samples[index - 1].positionPx;
      const current = stroke.samples[index];
      expect(current.deltaPx[0]).toBeCloseTo(current.positionPx[0] - previous[0], 8);
      expect(current.deltaPx[1]).toBeCloseTo(current.positionPx[1] - previous[1], 8);
    }
    const totalDelta = stroke.samples.reduce((sum: number[], sample: {
      deltaPx: readonly [number, number]
    }) => [
      sum[0] + sample.deltaPx[0], sum[1] + sample.deltaPx[1]
    ], [0, 0]);
    const first = stroke.samples[0].positionPx;
    const last = stroke.samples.at(-1).positionPx;
    expect(totalDelta[0]).toBeCloseTo(last[0] - first[0], 8);
    expect(totalDelta[1]).toBeCloseTo(last[1] - first[1], 8);
  });

  it('smooths Warp input in source space and catches up exactly on commit', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 17,
      mode: 'push',
      settings: { ...brush, diameterPx: 128, smooth: 2 },
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.move(17, point(80, 640, 20))).toBe(true);
    expect(controller.finish(17, 30)).toBe(true);

    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    const positions = settings.strokes[0]!.samples.map(({ positionPx }) => positionPx);
    expect(positions[1]![0]).toBeLessThan(100);
    expect(positions.at(-1)).toEqual([310, 10]);
    expect(settings.strokes[0]?.settings.smooth).toBe(2);
  });

  it('retains a coalesced Warp batch in order with one scheduled preview', () => {
    const state = harness();
    const schedule = vi.fn((task: () => void) => task());
    const controller = createWarpSessionController(
      () => state.dependencies,
      undefined,
      { schedule, flush: vi.fn(), cancel: vi.fn() }
    );
    expect(controller.begin({
      pointerId: 18,
      mode: 'push',
      settings: { ...brush, smooth: 0 },
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.moveMany(18, [
      point(100, 60, 20),
      point(120, 80, 21),
      point(140, 100, 22)
    ])).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
    expect(state.dependencies.applyDocumentSnapshot).not.toHaveBeenCalled();
    const layer = findRasterLayer(
      state.projectedDocument,
      state.projectedDocument.activeLayerId
    )!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    const stroke = settings.strokes[0]!;
    expect(stroke.samples).toHaveLength(4);
    expect(stroke.samples.map(({ timeMs }) => timeMs))
      .toEqual([10, 20, 21, 22]);
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
    expect(state.dependencies.onStrokeCommitted).not.toHaveBeenCalled();
    expect(state.document).toBe(before);
    expect(state.interactionBinding.setActive).toHaveBeenLastCalledWith(false, expect.any(String));

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

  it('retains one stack, module and renderer binding throughout a new Warp gesture', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 14,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    const initialLayer = findRasterLayer(
      state.projectedDocument,
      state.projectedDocument.activeLayerId
    )!;
    const stackId = initialLayer.adjustmentStack!.id;
    const moduleId = findWarpModuleInstance(initialLayer.adjustmentStack)!.id;
    const initialModuleRevision = findWarpModuleInstance(initialLayer.adjustmentStack)!.revision;
    const initialStackRevision = initialLayer.adjustmentStack!.revision;

    expect(controller.move(14, point(60, 60, 20))).toBe(true);
    expect(controller.move(14, point(40, 80, 30))).toBe(true);
    const finalPreviewLayer = findRasterLayer(
      state.projectedDocument,
      state.projectedDocument.activeLayerId
    )!;
    expect(finalPreviewLayer.adjustmentStack!.id).toBe(stackId);
    const finalPreviewModule = findWarpModuleInstance(finalPreviewLayer.adjustmentStack)!;
    expect(finalPreviewModule.id).toBe(moduleId);
    expect(finalPreviewModule.revision).toBeGreaterThan(initialModuleRevision);
    expect(finalPreviewLayer.adjustmentStack!.revision).toBeGreaterThan(initialStackRevision);
    expect(state.dependencies.createId.mock.calls.filter(([kind]) => kind === 'stack').length)
      .toBeLessThanOrEqual(1);
    expect(state.dependencies.createId.mock.calls.filter(([kind]) => kind === 'module')).toHaveLength(1);
    expect(state.dependencies.acquireInteractionBinding).toHaveBeenCalledOnce();
    expect(controller.finish(14, 40)).toBe(true);
    const committedLayer = findRasterLayer(state.document, state.document.activeLayerId)!;
    expect(committedLayer.adjustmentStack!.id).toBe(stackId);
    const committedModule = findWarpModuleInstance(committedLayer.adjustmentStack)!;
    expect(committedModule.id).toBe(moduleId);
    expect(committedModule.revision).toBeGreaterThan(finalPreviewModule.revision);
    expect(state.interactionBinding.requestCanonicalProjection)
      .toHaveBeenCalledExactlyOnceWith(moduleId, committedModule.revision);
    expect(state.dependencies.createId.mock.calls.filter(([kind]) => kind === 'module')).toHaveLength(1);
  });

  it('cancels through the opening renderer binding when that renderer is replaced', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 15,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    state.interactionCurrent = false;
    expect(controller.move(15, point(60, 60, 20))).toBe(false);
    expect(controller.active).toBe(false);
    expect(state.interactionBinding.setActive.mock.calls).toEqual([
      [true, expect.any(String)], [false, expect.any(String)]
    ]);
    expect(state.interactionBinding.requestCanonicalProjection).not.toHaveBeenCalled();
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
  });

  it('retires terminal renderer intent when history publication rejects the commit', () => {
    const state = harness();
    const opening = state.document;
    state.dependencies.pushHistoryEntry.mockImplementation(() => {
      throw new Error('history rejected');
    });
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 151,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.move(151, point(60, 60, 20))).toBe(true);
    expect(controller.finish(151, 30)).toBe(false);
    expect(state.retireCanonicalProjection).toHaveBeenCalledOnce();
    expect(state.document).toBe(opening);
    expect(controller.active).toBe(false);
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
    const publicationsAfterBegin = state.dependencies.previewDocumentSnapshot.mock.calls.length;

    expect(controller.move(8, point(60, 60, 20))).toBe(true);
    expect(controller.move(8, point(40, 80, 30))).toBe(true);
    expect(state.dependencies.previewDocumentSnapshot).toHaveBeenCalledTimes(publicationsAfterBegin);

    (frameCallback as (() => void) | null)?.();
    expect(state.dependencies.previewDocumentSnapshot)
      .toHaveBeenCalledTimes(publicationsAfterBegin + 1);

    expect(controller.move(8, point(20, 100, 40))).toBe(true);
    expect(controller.finish(8, 50)).toBe(true);
    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    expect(settings.strokes[0]?.samples).toHaveLength(4);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it('continues rate-based brushes while held still and commits one command', () => {
    const state = harness();
    let heldTick: ((timeMs: number) => void) | null = null;
    const stop = vi.fn();
    const controller = createWarpSessionController(
      () => state.dependencies,
      undefined,
      undefined,
      {
        start: (tick) => { heldTick = tick; },
        stop
      }
    );
    expect(controller.begin({
      pointerId: 12,
      mode: 'twirl-cw',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    (heldTick as ((timeMs: number) => void) | null)?.(60);
    (heldTick as ((timeMs: number) => void) | null)?.(110);
    expect(controller.finish(12, 120)).toBe(true);

    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!);
    expect(settings.strokes[0]?.mode).toBe('twirl-cw');
    expect(settings.strokes[0]?.samples).toHaveLength(3);
    expect(settings.strokes[0]?.samples.map(({ deltaPx }) => deltaPx)).toEqual([
      [0, 0], [0, 0], [0, 0]
    ]);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it('removes only Warp from the active layer and records one reversible command', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.begin({
      pointerId: 9,
      mode: 'push',
      settings: brush,
      point: point(80, 40, 10)
    })).toBe(true);
    expect(controller.move(9, point(60, 60, 20))).toBe(true);
    expect(controller.finish(9, 30)).toBe(true);
    state.dependencies.pushHistoryEntry.mockClear();

    const nonWarpBefore = findRasterLayer(
      state.document,
      state.document.activeLayerId
    )!.adjustmentStack!.modules.filter(({ type }) => type !== 'lt.warp');
    expect(controller.clearActiveLayer()).toBe(true);
    const clearedLayer = findRasterLayer(
      state.document,
      state.document.activeLayerId
    )!;
    expect(findWarpModuleInstance(clearedLayer.adjustmentStack)).toBeNull();
    expect(clearedLayer.adjustmentStack?.modules).toEqual(nonWarpBefore);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);

    const resetEntry = state.dependencies.pushHistoryEntry.mock.calls[0]![0];
    resetEntry.undo();
    expect(findWarpModuleInstance(
      findRasterLayer(state.document, state.document.activeLayerId)?.adjustmentStack
    )).not.toBeNull();
    resetEntry.redo();
    expect(findWarpModuleInstance(
      findRasterLayer(state.document, state.document.activeLayerId)?.adjustmentStack
    )).toBeNull();
  });

  it('does not create reset history when no Warp recipe exists', () => {
    const state = harness();
    const controller = createWarpSessionController(() => state.dependencies);
    expect(controller.clearActiveLayer()).toBe(false);
    expect(state.dependencies.applyDocumentSnapshot).not.toHaveBeenCalled();
    expect(state.dependencies.pushHistoryEntry).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith(
      'The active layer has no Warp edit to reset.'
    );
  });
});
