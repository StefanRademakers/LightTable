import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import { findWarpModuleInstance, readWarpNodeSettings } from '../../effects/warp/warpTypes';
import { parseSemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import { executeSemanticWarpStrokeCommand } from './semanticWarpCommandExecutor';
import { projectWarpQuery } from './warpQueryProjection';

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
    let document = createImageDocument('Warp command', 200, 100, 'source');
    const layer = findRasterLayer(document, document.activeLayerId)!;
    const history = vi.fn(); let id = 0;
    const result = executeSemanticWarpStrokeCommand(command(layer.id), {
      getDocument: () => document,
      applyDocument: (next) => { document = next; },
      recordHistory: history,
      createId: (kind) => `${kind}-${++id}`
    });
    expect(result).toEqual({ layerId: layer.id, strokeId: 'stroke-1', sampleCount: 2 });
    expect(history).toHaveBeenCalledOnce();
    const updated = findRasterLayer(document, layer.id)!;
    const settings = readWarpNodeSettings(findWarpModuleInstance(updated.adjustmentStack)!);
    expect(settings.strokes[0]).toMatchObject({ id: 'stroke-1', mode: 'push',
      samples: [{ positionPx: [10, 20] }, { positionPx: [11, 21] }] });
  });

  it('rejects invalid and oversized recipes before mutation', () => {
    const document = createImageDocument('Warp command', 200, 100, 'source');
    const layer = findRasterLayer(document, document.activeLayerId)!;
    expect(parseSemanticWarpStrokeCommand({ ...command(layer.id), mode: 'unknown' }))
      .toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand(command(layer.id, 4097))).toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand({ ...command(layer.id, 1),
      layerId: 'x'.repeat(241 * 1024) })).toHaveProperty('message');
    expect(parseSemanticWarpStrokeCommand({
      ...command(layer.id),
      settings: { ...command(layer.id).settings, strength: 2, smooth: 2 },
      samples: [{ ...command(layer.id).samples[0], tilt: [-90, 90] }]
    })).not.toHaveProperty('message');
  });

  it('projects a detached and bounded editable recipe', () => {
    let document = createImageDocument('Warp query', 200, 100, 'source');
    const layerId = document.activeLayerId!;
    let id = 0;
    for (let index = 0; index < 65; index += 1) {
      executeSemanticWarpStrokeCommand(command(layerId, 1), {
        getDocument: () => document,
        applyDocument: (next) => { document = next; },
        recordHistory: () => undefined,
        createId: (kind) => `${kind}-${++id}`
      });
    }
    const layer = findRasterLayer(document, layerId)!;
    const projected = projectWarpQuery(layer)!;
    expect(projected).toMatchObject({ totalStrokes: 65, totalSamples: 65, truncated: true });
    expect(projected.strokes).toHaveLength(64);
    const projectedFirst = projected.strokes[0].samples[0].positionPx;
    (projectedFirst as [number, number])[0] = 999;
    expect(readWarpNodeSettings(findWarpModuleInstance(layer.adjustmentStack)!)
      .strokes[0].samples[0].positionPx[0]).toBe(10);
  });

  it('rejects locked targets without publishing history', () => {
    let document = createImageDocument('Warp command', 200, 100, 'source');
    const layer = findRasterLayer(document, document.activeLayerId)!;
    document = { ...document, layers: [{ ...layer, locks: { ...layer.locks, pixels: true } }] };
    const history = vi.fn();
    expect(() => executeSemanticWarpStrokeCommand(command(layer.id), {
      getDocument: () => document, applyDocument: (next) => { document = next; },
      recordHistory: history, createId: (kind) => kind
    })).toThrow(/Unlock/);
    expect(history).not.toHaveBeenCalled();
  });
});
