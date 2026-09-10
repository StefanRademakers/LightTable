import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import { findWarpModuleInstance, MAX_WARP_STROKE_SAMPLES,
  readWarpNodeSettings } from '../../effects/warp/warpTypes';
import { parseSemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import { executeSemanticWarpStrokeCommand } from './semanticWarpCommandExecutor';
import { projectWarpQuery } from './warpQueryProjection';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';

const harness = (initial = createImageDocument('Warp command', 200, 100, 'source')) => {
  let document = initial;
  const history = vi.fn();
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: history
  }));
  let id = 0;
  return {
    dependencies: {
      getDocument: () => document,
      changeDocument: mutation.change,
      createId: (kind: 'stack' | 'module' | 'stroke') => `${kind}-${++id}`
    },
    history,
    get document() { return document; },
    set document(next) { document = next; }
  };
};

const command = (layerId: LayerId, sampleCount = 2) => ({
  layerId, mode: 'push' as const,
  settings: { diameterPx: 120, strength: 0.5, hardness: 0.6, flow: 1,
    spacing: 0.1, smooth: 0, pressureSize: true, pressureStrength: true },
  samples: Array.from({ length: sampleCount }, (_, index) => ({
    positionPx: [10 + index, 20 + index] as [number, number],
    deltaPx: [index ? 1 : 0, index ? 1 : 0] as [number, number],
    pressure: 1, tilt: [0, 0] as [number, number], timeMs: 1000 + index * 16
  })),
  startedAtMs: 1000, durationMs: Math.max(0, sampleCount - 1) * 16
});

describe('semantic Warp stroke command', () => {
  it('appends one editable recipe and one history entry without gesture previews', () => {
    const state = harness();
    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const result = executeSemanticWarpStrokeCommand(command(layer.id), state.dependencies);
    expect(result).toEqual({ layerId: layer.id, strokeId: 'stroke-1', sampleCount: 2 });
    expect(state.history).toHaveBeenCalledOnce();
    const updated = findRasterLayer(state.document, layer.id)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(updated.adjustmentStack)!);
    expect(settings.strokes[0]).toMatchObject({ id: 'stroke-1', mode: 'push',
      samples: [{ positionPx: [10, 20] }, { positionPx: [11, 21] }] });
  });

  it('rejects invalid and oversized recipes before mutation', () => {
    const document = createImageDocument('Warp command', 200, 100, 'source');
    const layer = findRasterLayer(document, document.activeLayerId)!;
    expect(parseSemanticWarpStrokeCommand({ ...command(layer.id), mode: 'unknown' }))
      .toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand(command(layer.id, MAX_WARP_STROKE_SAMPLES + 1)))
      .toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand({ ...command(layer.id), mode: 'smooth' }))
      .toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand({ ...command(layer.id, 1),
      layerId: 'x'.repeat(241 * 1024) })).toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand({
      ...command(layer.id),
      settings: { ...command(layer.id).settings, strength: 2, smooth: 2 },
      samples: [{ ...command(layer.id).samples[0], tilt: [-90, 90] }]
    })).not.toHaveProperty('message');
  });

  it('projects a detached and bounded editable recipe', () => {
    const state = harness(createImageDocument('Warp query', 200, 100, 'source'));
    const layerId = state.document.activeLayerId!;
    for (let index = 0; index < 65; index += 1) {
      executeSemanticWarpStrokeCommand(command(layerId, 1), state.dependencies);
    }
    const layer = findRasterLayer(state.document, layerId)!;
    const projected = projectWarpQuery(layer)!;
    expect(projected).toMatchObject({ totalStrokes: 65, totalSamples: 65, truncated: true });
    expect(projected.strokes).toHaveLength(64);
    const projectedFirst = projected.strokes[0].samples[0].positionPx;
    (projectedFirst as [number, number])[0] = 999;
    expect(readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!)
      .strokes[0].samples[0].positionPx[0]).toBe(10);
  });

  it('rejects locked targets without publishing history', () => {
    const initial = createImageDocument('Warp command', 200, 100, 'source');
    const layer = findRasterLayer(initial, initial.activeLayerId)!;
    const state = harness({ ...initial, layers: [{ ...layer, locks: { ...layer.locks, pixels: true } }] });
    expect(() => executeSemanticWarpStrokeCommand(command(layer.id), state.dependencies)).toThrow(/Unlock/);
    expect(state.history).not.toHaveBeenCalled();
  });

  it('rejects publication after the exact opening document was replaced', () => {
    const state = harness();
    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    const opening = state.document;
    const dependencies = { ...state.dependencies,
      changeDocument: ((mutate: (current: typeof opening) => typeof opening) => {
        state.document = { ...opening };
        return state.dependencies.changeDocument(mutate);
      }) as typeof state.dependencies.changeDocument };
    expect(executeSemanticWarpStrokeCommand(command(layer.id), dependencies)).toBeNull();
    expect(state.document).not.toBe(opening);
    expect(state.history).not.toHaveBeenCalled();
  });
});
