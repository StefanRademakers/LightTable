import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import type { LayerId } from '../../../editor/document/documentTypes';
import { createEditorSession } from '../../../editor/session/editorSession';
import { identityMatrix, translationMatrix } from '../../../editor/tools/transform/affine';
import type { AffineMatrix, TransformQuad, TransformSessionState } from '../../../editor/tools/transform/transformTypes';
import type { SnapMatch } from '../snapping/snapEngine';
import { TransformPresentationBinding, type TransformPresentationInputs } from './TransformPresentationBinding';

const state: TransformSessionState = {
  layerId: 'moving' as LayerId, sourceBounds: { x: 0, y: 0, width: 40, height: 30 },
  supportBounds: { x: 0, y: 0, width: 40, height: 30 },
  sourceContentBounds: { x: 0, y: 0, width: 40, height: 30 },
  sourceMatrix: identityMatrix(), matrix: identityMatrix(), projectiveQuad: null,
  sourceKind: 'layer', previewKind: 'raster'
};
const match: SnapMatch = { axis: 'x', deltaDocument: 0, deltaScreen: 0,
  moving: { axis: 'x', position: 20, source: 'selection', role: 'min' },
  target: { axis: 'x', position: 20, source: 'canvas', role: 'center' } };
const setup = () => {
  let current = true;
  const inputs: TransformPresentationInputs = { state, frameOverride: null, temporaryMove: false,
    scale: 1, frameMode: 'document', snap: { ...createEditorSession().snap, smartGuidesVisible: true },
    selectionFeedback: { matches: [match], bounds: { x: 5, y: 5, width: 10, height: 10 } },
    document: createImageDocument('Snap', 100, 80, 'snap'), selectedLayerIds: [] };
  let view = inputs;
  const renderer = { setTransformEditingFrame: vi.fn(), setSmartGuideEditingFrame: vi.fn() };
  const operations = {
    update: vi.fn((matrix: AffineMatrix): TransformSessionState | null => ({ ...state, matrix })),
    updateProjective: vi.fn((projectiveQuad: TransformQuad): TransformSessionState | null => ({ ...state, projectiveQuad }))
  };
  const binding = new TransformPresentationBinding(renderer, () => current, () => view, operations);
  return { binding, renderer, operations, setView: (change: Partial<TransformPresentationInputs>) => {
    view = { ...view, ...change };
  }, retire: () => { current = false; } };
};

describe('TransformPresentationBinding', () => {
  it('retains immediate pointer projection across unrelated renders, then accepts a new checkpoint', () => {
    const f = setup(); f.binding.mount();
    expect(f.binding.update(translationMatrix(25, 10), [match])).toBe(true);
    f.binding.present();
    expect(f.renderer.setTransformEditingFrame.mock.lastCall?.[0].bounds.x).toBe(25);
    f.setView({ state: { ...state, matrix: translationMatrix(30, 10) } });
    f.binding.present();
    expect(f.renderer.setTransformEditingFrame.mock.lastCall?.[0].bounds.x).toBe(30);
  });
  it('has one guide arbiter and restores selection feedback when transform ends', () => {
    const f = setup(); f.binding.mount();
    f.binding.setSnapMatches([match]);
    expect(f.renderer.setSmartGuideEditingFrame.mock.lastCall?.[0]).not.toBeNull();
    f.setView({ state: null }); f.binding.present();
    expect(f.renderer.setTransformEditingFrame).toHaveBeenLastCalledWith(null);
    expect(f.renderer.setSmartGuideEditingFrame.mock.lastCall?.[0]).not.toBeNull();
    f.binding.setSnapMatches([]);
    expect(f.renderer.setSmartGuideEditingFrame.mock.lastCall?.[0]).not.toBeNull();
  });
  it('clears a rejected preview without resurrecting its stale rendered checkpoint', () => {
    const f = setup(); f.binding.mount();
    f.operations.update.mockReturnValueOnce(null);
    expect(f.binding.update(identityMatrix(), [match])).toBe(false);
    f.binding.present();
    expect(f.renderer.setTransformEditingFrame).toHaveBeenLastCalledWith(null);
  });
  it('suppresses the cage for temporary moves and reads current visibility settings', () => {
    const f = setup(); f.binding.mount();
    f.setView({ temporaryMove: true }); f.binding.present();
    f.binding.update(translationMatrix(20, 0), [match]);
    expect(f.renderer.setTransformEditingFrame).toHaveBeenLastCalledWith(null);
    f.setView({ snap: { ...createEditorSession().snap, extrasVisible: false } });
    f.binding.present();
    expect(f.renderer.setSmartGuideEditingFrame).toHaveBeenLastCalledWith(null);
  });
  it('rejects stale callbacks and cannot clear a successor renderer during cleanup', () => {
    const f = setup(); f.binding.mount(); f.retire();
    f.renderer.setTransformEditingFrame.mockClear(); f.renderer.setSmartGuideEditingFrame.mockClear();
    expect(f.binding.update(identityMatrix(), [])).toBe(false);
    f.binding.present(); f.binding.setSnapMatches([match]); f.binding.unmount();
    expect(f.operations.update).not.toHaveBeenCalled();
    expect(f.renderer.setTransformEditingFrame).not.toHaveBeenCalled();
    expect(f.renderer.setSmartGuideEditingFrame).not.toHaveBeenCalled();
    expect(f.binding.getSnapTargets()).toEqual([]);
  });
  it('supports StrictMode cleanup/setup replay and projective updates', () => {
    const f = setup(); f.binding.mount(); f.binding.unmount();
    expect(f.binding.update(identityMatrix(), [])).toBe(false);
    f.binding.mount();
    const quad = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 40, y: 40 }, { x: 0, y: 30 }] as const;
    expect(f.binding.updateProjective(quad, [])).toBe(true);
    expect(f.renderer.setTransformEditingFrame.mock.lastCall?.[0].bounds.x).toBe(0);
    expect(f.binding.getSnapTargets().length).toBeGreaterThan(0);
  });
});
