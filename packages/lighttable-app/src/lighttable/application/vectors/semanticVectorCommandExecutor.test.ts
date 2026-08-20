import { describe, expect, it, vi } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createAnchor, createSubpath, createVectorLiveShape, createVectorPath
} from '@lighttable/vector-core';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { parseSemanticVectorCommand } from '../commands/semanticVectorCommandContract';
import { executeSemanticVectorCommand } from './semanticVectorCommandExecutor';
import { observedLiveShapeCreateCommand, observedLiveShapeUpdateCommand, observedVectorPathCreateCommand,
  observedVectorPathUpdateCommand } from './semanticVectorObservation';

const harness = () => {
  let document = createImageDocument('Vectors', 640, 480, 'fixture');
  const history = vi.fn();
  const dependencies = { getDocument: () => document,
    applyDocument: (next: typeof document) => { document = next; }, recordHistory: history };
  return { dependencies, history, document: () => document };
};

describe('semantic vector commands', () => {
  it('creates and updates an editable live shape atomically with shared gradient paint', () => {
    const state = harness();
    const gradient = createDefaultGradientPaint('semantic-gradient');
    const created = executeSemanticVectorCommand({ kind: 'create', name: 'Badge',
      primitive: { kind: 'rectangle', x: 20, y: 30, width: 180, height: 90, cornerRadii: [8, 8, 8, 8] },
      style: { fill: gradient, stroke: { paint: { type: 'solid', color: [1, 0, 0, 1] },
        width: 12, alignment: 'outside', cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0 }, opacity: 0.8 } }, state.dependencies)!;
    const layer = findDocumentLayer(state.document(), created.layerId)!;
    expect(layer.type).toBe('vector');
    if (layer.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.elements[0]).toMatchObject({ id: created.elementId, type: 'live-shape',
      style: { fill: { kind: 'gradient' }, stroke: { width: 12 }, opacity: 0.8 } });

    executeSemanticVectorCommand({ kind: 'update', layerId: created.layerId,
      elementId: created.elementId, transform: { a: 1, b: 0, c: 0, d: 1, tx: 44, ty: 55 },
      style: { fill: null, opacity: 1 } }, state.dependencies);
    const updated = findDocumentLayer(state.document(), created.layerId)!;
    if (updated.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements[0]).toMatchObject({ transform: { tx: 44, ty: 55 }, style: { fill: null, opacity: 1 } });
    expect(state.history).toHaveBeenCalledTimes(2);
  });

  it('creates a bounded compound path and removes it in one publication each', () => {
    const state = harness();
    const created = executeSemanticVectorCommand({ kind: 'create', name: 'Compound', fillRule: 'evenodd',
      subpaths: [
        { closed: true, anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
        { closed: true, anchors: [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }] }
      ] }, state.dependencies)!;
    const layer = findDocumentLayer(state.document(), created.layerId)!;
    if (layer.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.elements[0]).toMatchObject({ type: 'path', fillRule: 'evenodd', subpaths: [{}, {}] });
    executeSemanticVectorCommand({ kind: 'remove', layerId: created.layerId,
      elementId: created.elementId }, state.dependencies);
    expect((findDocumentLayer(state.document(), created.layerId) as typeof layer).elements).toHaveLength(0);
    expect(state.history).toHaveBeenCalledTimes(2);
  });

  it('rejects excessive path and gradient payloads before mutation', () => {
    const anchors = Array.from({ length: 8193 }, (_, index) => ({ x: index, y: 0 }));
    expect(parseSemanticVectorCommand('create', { subpaths: [{ closed: false, anchors }] })).toHaveProperty('message');
    const base = createDefaultGradientPaint('too-many');
    const gradient = { ...base, asset: { ...base.asset,
      colorStops: Array.from({ length: 65 }, (_, index) => ({
      id: `stop-${index}`, position: index / 64, midpoint: 0.5,
      color: { r: 0, g: 0, b: 0, a: 1 }
    })) } };
    expect(parseSemanticVectorCommand('create', { primitive: { kind: 'ellipse', x: 0, y: 0, width: 10, height: 10 },
      style: { fill: gradient } })).toHaveProperty('message');
  });

  it('rejects private pointer state, incomplete strokes and malformed live geometry at the command boundary', () => {
    const rectangle = { primitive: { kind: 'rectangle', x: 0, y: 0, width: 40, height: 20 } };
    expect(parseSemanticVectorCommand('create', {
      ...rectangle, pointerSamples: [{ x: 0, y: 0 }]
    })).toHaveProperty('message');
    expect(parseSemanticVectorCommand('create', {
      ...rectangle, style: { stroke: {
        paint: { type: 'solid', color: [0, 0, 0, 1] }, width: 2, dash: []
      } }
    })).toHaveProperty('message');
    expect(parseSemanticVectorCommand('update', {
      layerId: 'shape-layer', elementId: 'shape',
      geometry: { kind: 'rectangle', width: 40, height: 20 }
    })).toHaveProperty('message');
    expect(parseSemanticVectorCommand('update', {
      layerId: 'shape-layer', elementId: 'shape'
    })).toHaveProperty('message');
    expect(parseSemanticVectorCommand('update', {
      layerId: 'shape-layer', elementId: 'shape',
      geometry: { kind: 'ellipse', width: 40, height: 20 }, fillRule: 'evenodd'
    })).toHaveProperty('message');
    expect(parseSemanticVectorCommand('remove', {
      layerId: 'shape-layer', elementId: 'shape', selectionBounds: [0, 0, 40, 20]
    })).toHaveProperty('message');
  });

  it('round-trips authored toolbar shape properties through vector.create', () => {
    const cases = [
      { kind: 'rectangle' as const, width: 80, height: 40,
        cornerRadii: [3, 6, 9, 12] as [number, number, number, number], linkedCorners: false },
      { kind: 'ellipse' as const, width: 72, height: 36 },
      { kind: 'triangle' as const, width: 70, height: 60, cornerRadius: 7 },
      { kind: 'line' as const, start: { x: 0, y: 0 }, end: { x: 90, y: 40 },
        startArrow: { width: 8, length: 12, concavity: 0 },
        endArrow: { width: 10, length: 16, concavity: 0.25 } }
    ];
    for (const [index, geometry] of cases.entries()) {
      const state = harness();
      const element = createVectorLiveShape(`observed-${index}`, geometry, `Observed ${geometry.kind}`);
      element.transform = { a: 0.9, b: 0.1, c: -0.1, d: 0.9, tx: 31, ty: 27 };
      element.style.opacity = 0.65;
      const parameters = observedLiveShapeCreateCommand(element, undefined, 'Shape');
      expect(parameters).not.toBeNull();
      const parsed = parseSemanticVectorCommand('create', parameters);
      expect(parsed).not.toHaveProperty('message');
      const created = executeSemanticVectorCommand(parsed as Extract<typeof parsed, { kind: 'create' }>,
        state.dependencies)!;
      const layer = findDocumentLayer(state.document(), created.layerId);
      const replayed = layer?.type === 'vector' ? layer.elements[0] : null;
      expect(replayed).toMatchObject({ type: 'live-shape', name: element.name,
        geometry, transform: element.transform, style: element.style });
      expect(layer?.name).toBe('Shape');
    }
  });

  it('round-trips Gradient Fill role, presentation and editable axis', () => {
    const state = harness();
    const element = createVectorLiveShape('gradient-shape', {
      kind: 'rectangle', width: 640, height: 480,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    }, 'Gradient Fill');
    const fill = { ...createDefaultGradientPaint('recorded-gradient', 'document'),
      transform: { a: 300, b: 20, c: -20, d: 300, tx: 40, ty: 50 } };
    element.style = { fill, stroke: null, opacity: 1 };
    const createParameters = observedLiveShapeCreateCommand(element, undefined, 'Gradient Fill', {
      role: 'gradient-fill', opacity: 0.7, blendMode: 'multiply'
    });
    const parsed = parseSemanticVectorCommand('create', createParameters);
    expect(parsed).not.toHaveProperty('message');
    const created = executeSemanticVectorCommand(
      parsed as Extract<typeof parsed, { kind: 'create' }>, state.dependencies
    )!;
    const layer = findDocumentLayer(state.document(), created.layerId);
    expect(layer).toMatchObject({
      type: 'vector', role: 'gradient-fill', opacity: 0.7, blendMode: 'multiply'
    });
    const replayed = layer?.type === 'vector' ? layer.elements[0] : null;
    if (replayed?.type !== 'live-shape') throw new Error('Expected Gradient Fill live shape.');
    const edited = structuredClone(replayed);
    if (!edited.style.fill || !('kind' in edited.style.fill)) throw new Error('Expected gradient paint.');
    edited.style = { ...edited.style, fill: {
      ...edited.style.fill,
      transform: { ...edited.style.fill.transform, tx: 75 }
    } };
    executeSemanticVectorCommand({ kind: 'update',
      ...observedLiveShapeUpdateCommand(edited, created.layerId) }, state.dependencies);
    const updatedLayer = findDocumentLayer(state.document(), created.layerId);
    const updated = updatedLayer?.type === 'vector' ? updatedLayer.elements[0] : null;
    expect(updated?.style.fill && 'kind' in updated.style.fill
      ? updated.style.fill.transform.tx : null).toBe(75);
  });

  it('rejects layer presentation when appending to an existing vector layer', () => {
    expect(parseSemanticVectorCommand('create', {
      layerId: 'existing', layerRole: 'gradient-fill',
      primitive: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10 }
    })).toHaveProperty('message');
  });

  it('round-trips curved Pen creation and resumed updates without flattening', () => {
    const state = harness();
    const path = createVectorPath('observed-path', 'Pen artwork', [createSubpath('curve', [
      { ...createAnchor('a', { x: 10, y: 12 }), handleOut: { x: 24, y: 3 }, mode: 'smooth' },
      { ...createAnchor('b', { x: 90, y: 54 }), handleIn: { x: 65, y: 70 }, mode: 'smooth' }
    ], false)]);
    path.fillRule = 'evenodd';
    path.transform = { a: 1, b: 0.1, c: 0, d: 1, tx: 14, ty: 8 };
    path.style.opacity = 0.72;
    const createParameters = observedVectorPathCreateCommand(path, undefined, 'Shape');
    const parsedCreate = parseSemanticVectorCommand('create', createParameters);
    expect(parsedCreate).not.toHaveProperty('message');
    const created = executeSemanticVectorCommand(
      parsedCreate as Extract<typeof parsedCreate, { kind: 'create' }>, state.dependencies
    )!;
    const createdLayer = findDocumentLayer(state.document(), created.layerId);
    const replayed = createdLayer?.type === 'vector' ? createdLayer.elements[0] : null;
    expect(createdLayer?.name).toBe('Shape');
    expect(replayed).toMatchObject({ type: 'path', name: path.name,
      subpaths: path.subpaths, transform: path.transform, style: path.style });

    if (replayed?.type !== 'path') throw new Error('Expected replayed path.');
    const resumed = structuredClone(replayed);
    resumed.subpaths[0]!.anchors.push(createAnchor('c', { x: 130, y: 28 }));
    const updateParameters = observedVectorPathUpdateCommand(resumed, created.layerId);
    const parsedUpdate = parseSemanticVectorCommand('update', updateParameters);
    expect(parsedUpdate).not.toHaveProperty('message');
    executeSemanticVectorCommand(
      parsedUpdate as Extract<typeof parsedUpdate, { kind: 'update' }>, state.dependencies
    );
    const updatedLayer = findDocumentLayer(state.document(), created.layerId);
    const updated = updatedLayer?.type === 'vector' ? updatedLayer.elements[0] : null;
    expect(updated?.type === 'path' ? updated.subpaths[0]?.anchors : []).toHaveLength(3);
    expect(state.history).toHaveBeenCalledTimes(2);
  });
});
