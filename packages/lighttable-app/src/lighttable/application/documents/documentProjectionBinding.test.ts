import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import { AdjustmentPresentationSynchronizer } from '../adjustments/AdjustmentPresentationSynchronizer';
import { projectAdjustmentSnapshot } from '../adjustments/projectAdjustmentSnapshot';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import { createDocumentProjectionBinding } from './documentProjectionBinding';

const setup = () => {
  let document = createImageDocument('Projection', 32, 24, 'one');
  let adjustments = createDefaultAdjustments();
  let target: PropertiesInspectorTarget = { kind: 'layer', layerId: document.activeLayerId! };
  const order: string[] = [];
  const publish = vi.fn();
  const renderer = vi.fn();
  const presentation = new AdjustmentPresentationSynchronizer(publish);
  const resetActive = vi.fn(() => { order.push('retire-active'); });
  const stage = vi.fn();
  const controller = createDocumentProjectionBinding({
    presentation, getPropertiesTarget: () => target, resetActiveAdjustmentPreview: resetActive,
    getDocument: () => document,
    publishDocument: next => { if (next) document = next; order.push('document'); },
    getDocumentAdjustments: () => adjustments,
    publishDocumentAdjustments: next => { adjustments = next; },
    publishEditorAdjustments: presentation.publishPresentation,
    stageEditorAdjustments: stage,
    getGroupVisibility: createDefaultGroupVisibility,
    publishGroupVisibility: vi.fn(),
    publishRendererDocument: renderer,
    publishRendererAdjustments: vi.fn()
  });
  return { controller, presentation, publish, renderer, stage, resetActive, order,
    get document() { return document; }, get adjustments() { return adjustments; },
    setTarget: (next: PropertiesInspectorTarget) => { target = next; },
    rebind: (next: ImageDocument) => { document = next; }
  };
};

describe('document projection binding', () => {
  it('retires only active preview before canonical publication; does not cancel pending successor ownership', () => {
    const state = setup();
    // No broad reset port exists. The mounted adapter binds the active-only
    // transaction controller, not the all-gesture admission owner.
    state.controller.applyDocumentSnapshot({ ...state.document, name: 'Renamed' });
    expect(state.order).toEqual(['retire-active', 'document']);
    expect(state.resetActive).toHaveBeenCalledOnce();
    expect(state.renderer).toHaveBeenCalledWith(state.document);
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('reuses contextual source on unrelated edits but invalidates after arbitrary panel publication', () => {
    const state = setup();
    state.controller.applyDocumentSnapshot(state.document);
    state.controller.applyDocumentSnapshot({ ...state.document, name: 'Unrelated' });
    expect(state.publish).toHaveBeenCalledOnce();
    state.presentation.publishPresentation({ ...state.adjustments, exposureEV: 4 }, 'grade');
    state.controller.applyDocumentSnapshot(state.document);
    expect(state.publish).toHaveBeenCalledTimes(3);
    expect(state.publish.mock.lastCall?.[0].exposureEV).toBe(0);
  });

  it('retains preview between samples without canonical or React presentation publication', () => {
    const state = setup();
    const before = state.document;
    state.controller.previewDocumentSnapshot({ ...before, name: 'Gesture' });
    state.controller.previewAdjustmentSnapshot({ ...state.adjustments, exposureEV: 2 }, before.activeLayerId);
    expect(state.document).toBe(before);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.resetActive).not.toHaveBeenCalled();
    expect(state.stage).toHaveBeenCalledOnce();
    expect(state.renderer.mock.lastCall?.[0].name).toBe('Gesture');
    state.controller.discardDocumentPreview();
    expect(state.renderer.mock.lastCall?.[0]).toBe(before);
  });

  it('restores the inspector from the canonical local stack while preserving global settings', () => {
    const state = setup();
    const before = state.document;
    const projected = projectAdjustmentSnapshot({ document: before,
      documentAdjustments: state.adjustments,
      snapshot: { ...state.adjustments, exposureEV: 2 }, targetLayerId: before.activeLayerId });
    state.controller.applyCanonicalAdjustmentProjection(projected, 'grade');
    expect(state.publish.mock.lastCall?.[0].exposureEV).toBe(2);
    expect(state.adjustments.exposureEV).toBe(0);
    state.controller.applyDocumentSnapshot(before);
    expect(state.publish.mock.lastCall?.[0].exposureEV).toBe(0);
  });

  it('keeps Grade and Lens FX contextual domains separate', () => {
    const state = setup();
    state.setTarget({ kind: 'document-processing', owner: 'grade' });
    state.controller.applyDocumentSnapshot(state.document);
    expect(state.publish.mock.lastCall?.[1]).toBe('grade');
    state.setTarget({ kind: 'document-processing', owner: 'lens-fx' });
    state.controller.applyDocumentSnapshot(state.document);
    expect(state.publish.mock.lastCall?.[1]).toBe('lens-fx');
  });

  it('does not reuse a context cache or preview across a document rebind', () => {
    const state = setup();
    const before = state.document;
    state.controller.applyDocumentSnapshot(before);
    state.controller.previewDocumentSnapshot({ ...before, name: 'Transient' });
    const next = { ...before, id: `${before.id}-next` as typeof before.id, name: 'Next' };
    state.rebind(next);
    state.controller.applyDocumentSnapshot(next);
    expect(state.publish).toHaveBeenCalledTimes(2);
    state.controller.discardDocumentPreview();
    expect(state.renderer.mock.lastCall?.[0]).toBe(next);
  });

  it('does not publish a document after the active-preview terminal fails', () => {
    const state = setup();
    const before = state.document;
    state.resetActive.mockImplementation(() => { throw new Error('preview lease failure'); });
    expect(() => state.controller.applyDocumentSnapshot({ ...before, name: 'Rejected' }))
      .toThrow('preview lease failure');
    expect(state.document).toBe(before);
    expect(state.publish).not.toHaveBeenCalled();
  });
});
