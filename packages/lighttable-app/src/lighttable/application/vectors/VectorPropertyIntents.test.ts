import { describe, expect, it, vi } from 'vitest';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { createEditorSession } from '../../editor/session/editorSession';
import { createVectorDocumentTestHarness } from './vectorDocumentTestHarness';
import { VectorToolSessionController } from './VectorToolSessionController';
import { VectorPropertyIntents } from './VectorPropertyIntents';
import { patchSelectedShape, selectedShapeGeometry } from './vectorPropertyProjection';

const setup = () => {
  const session = createEditorSession();
  const shape = createVectorLiveShape('shape', { kind: 'rectangle', width: 80, height: 40,
    cornerRadii: [0, 0, 0, 0], linkedCorners: true });
  const layer = createVectorLayer([shape]);
  const document = createImageDocument('test', 200, 200, 'asset');
  document.layers = [layer]; document.activeLayerId = layer.id;
  session.vectorSelection.elements = [{ layerId: layer.id, elementId: shape.id }];
  const host = createVectorDocumentTestHarness(document);
  const edits = new VectorToolSessionController({
    ...host.dependencies, getRendererGeneration: () => 1,
    captureRuntime: () => ({ isCurrent: () => true }),
    getSelection: () => session.vectorSelection,
    setSelection: value => { session.vectorSelection = value; },
    reportError: vi.fn(), captureTransformPreview: () => null
  }, { rasterizeShape: async () => false });
  const owner = new VectorPropertyIntents(() => ({
    getDocument: () => host.canonicalDocument, getSession: () => session, edits,
    setShapeDefaults: change => { session.shape = { ...session.shape, ...change }; },
    setGradientDefaults: change => { session.gradient = { ...session.gradient, ...change }; }
  }));
  return { session, shape: layer.elements[0]! as typeof shape, layer, host, owner, edits };
};

describe('vector property intents through actual document transactions', () => {
  it('updates creation options without document/history, and authored geometry separately', () => {
    const h = setup(); const before = h.host.canonicalDocument;
    h.owner.updateShape({ geometry: 'fixed', fromCenter: true, snapToPixels: true });
    expect(h.session.shape).toMatchObject({ geometry: 'fixed', fromCenter: true, snapToPixels: true });
    expect(h.host.canonicalDocument).toBe(before); expect(h.host.history).toHaveLength(0);
    h.owner.updateShape({ width: 120 });
    expect(h.host.history).toHaveLength(1);
    expect(selectedShapeGeometry(h.host.document, h.session.vectorSelection, h.session.shape)?.settings.width).toBe(120);
    expect(h.session.shape.width).not.toBe(120);
  });
  it('does not revise unchanged properties, including differently ordered gradient objects', () => {
    const h = setup();
    h.owner.updateShape({ width: 80, rectangleCornerRadii: [0, 0, 0, 0] });
    h.owner.updateStyle({ opacity: h.shape.style.opacity });
    expect(h.host.history).toHaveLength(0);
    h.shape.style.fill = createDefaultGradientPaint('g', 'document');
    h.layer.role = 'gradient-fill'; h.session.activeTool = 'gradient';
    const fill = h.shape.style.fill;
    const { transform, ...rest } = fill;
    h.owner.updateGradient({ paint: { transform, ...rest } });
    expect(h.host.history).toHaveLength(0);
  });
  it('updates selected gradient paint while preserving authored placement and exact undo/redo', () => {
    const h = setup(); h.layer.role = 'gradient-fill'; h.session.activeTool = 'gradient';
    const base = createDefaultGradientPaint('g', 'document');
    const paint = { ...base, transform: { ...base.transform, tx: 35, ty: 47 } };
    h.shape.style.fill = paint;
    const before = h.host.canonicalDocument;
    h.owner.updateGradient({ paint: { ...paint, shape: 'radial', transform: { ...paint.transform, tx: 999 } } });
    expect(h.host.history).toHaveLength(1);
    const after = h.host.canonicalDocument;
    expect(after.layers[0]).toMatchObject({ elements: [{ style: { fill: {
      shape: 'radial', coordinateSpace: 'document', transform: { tx: 35, ty: 47 }
    } }, styleRevision: 1 }] });
    h.host.history[0]!.entry.undo(); expect(h.host.canonicalDocument).toBe(before);
    h.host.history[0]!.entry.redo(); expect(h.host.canonicalDocument).toBe(after);
  });
  it('reads current target and retains all-or-nothing locked multi-selection', () => {
    const h = setup(); const other = createVectorLayer([createVectorLiveShape('other', {
      kind: 'ellipse', width: 30, height: 40 })]);
    other.locks.pixels = true;
    const before = { ...h.host.canonicalDocument, layers: [h.layer, other] };
    h.host.replaceDocument(before);
    h.session.vectorSelection.elements.push({ layerId: other.id, elementId: 'other' });
    expect(h.owner.updateShape({ width: 200 })).toBe(false);
    expect(h.host.canonicalDocument).toBe(before); expect(h.host.history).toHaveLength(0);
    h.session.vectorSelection.elements = [{ layerId: h.layer.id, elementId: h.shape.id }];
    expect(h.owner.updateShape({ width: 200 })).toBe(true);
    expect(h.host.history).toHaveLength(1);
  });
  it('does not turn pixel gradient defaults into an authored fill edit', () => {
    const h = setup(); h.layer.role = 'gradient-fill'; h.session.activeTool = 'gradient';
    h.session.gradient.application = 'pixels'; h.shape.style.fill = h.session.gradient.paint;
    h.owner.updateGradient({ paint: { ...h.session.gradient.paint, shape: 'radial' } });
    expect(h.session.gradient.paint.shape).toBe('radial'); expect(h.host.history).toHaveLength(0);
  });
});

describe('shape property geometry preservation', () => {
  it('preserves fractional endpoints on unchanged dimensions and unrelated arrow edits', () => {
    const h = setup();
    h.layer.elements = [createVectorLiveShape('shape', { kind: 'line',
      start: { x: 1, y: 1 }, end: { x: 0.2, y: 0.3 }, startArrow: null, endArrow: null })];
    const before = h.host.canonicalDocument;
    const settings = selectedShapeGeometry(before, h.session.vectorSelection, h.session.shape)!.settings;
    h.owner.updateShape({ width: settings.width, height: settings.height });
    expect(h.host.canonicalDocument).toBe(before); expect(h.host.history).toHaveLength(0);
    h.owner.updateShape({ lineEndArrow: true });
    expect(h.host.document.layers[0]).toMatchObject({ elements: [{ geometry: { end: { x: 0.2, y: 0.3 } } }] });
    expect(h.host.history).toHaveLength(1);
  });
  it('round-trips the projected line angle without manufacturing geometry/history', () => {
    const h = setup();
    const line = createVectorLiveShape('shape', { kind: 'line', start: { x: 10, y: 20 },
      end: { x: 50, y: 60 }, startArrow: { width: 4, length: 8, concavity: 0.2 },
      endArrow: { width: 6, length: 10, concavity: 0.4 } });
    h.layer.elements = [line];
    const before = h.host.canonicalDocument;
    const settings = selectedShapeGeometry(before, h.session.vectorSelection, h.session.shape)!.settings;
    h.owner.updateShape({ lineRotationDegrees: settings.lineRotationDegrees });
    h.owner.updateShape({ width: settings.width });
    expect(h.host.canonicalDocument).toBe(before); expect(h.host.history).toHaveLength(0);
  });
  it('preserves signed line endpoints and unrelated independent arrow geometry', () => {
    const shape = createVectorLiveShape('line', { kind: 'line', start: { x: 10, y: 20 },
      end: { x: -20, y: -20 }, startArrow: { width: 4, length: 8, concavity: 0.2 },
      endArrow: { width: 6, length: 10, concavity: 0.4 } });
    patchSelectedShape(shape, { width: 50 }, createEditorSession().shape);
    expect(shape.geometry).toMatchObject({ end: { x: -40, y: -20 },
      startArrow: { width: 4, length: 8, concavity: 0.2 }, endArrow: { width: 6, length: 10, concavity: 0.4 } });
    patchSelectedShape(shape, { lineRotationDegrees: 90 }, createEditorSession().shape);
    if (shape.geometry.kind !== 'line') throw new Error('Expected line');
    expect(shape.geometry.end.x).toBeCloseTo(10);
    expect(shape.geometry.end.y - 20).toBeCloseTo(Math.hypot(50, 40));
  });
  it('keeps ellipse and rectangle edits parametric and corner arrays independent', () => {
    const h = setup(); const radii: [number, number, number, number] = [1, 2, 3, 4];
    patchSelectedShape(h.shape, { rectangleCornerRadii: radii, linkedCorners: false }, h.session.shape);
    radii[0] = 99;
    expect(h.shape.geometry).toMatchObject({ cornerRadii: [1, 2, 3, 4], linkedCorners: false });
    const ellipse = createVectorLiveShape('ellipse', { kind: 'ellipse', width: 5, height: 6 });
    patchSelectedShape(ellipse, { width: 20, height: 30 }, h.session.shape);
    expect(ellipse.geometry).toEqual({ kind: 'ellipse', width: 20, height: 30 });
  });
});
