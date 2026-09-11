import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { addRasterLayerAttachedAdjustment, createAdjustmentLayer, removeRasterLayerAttachedAdjustment } from '../../editor/document/documentCommands';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { attachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import { createDefaultAdjustments } from '../../types';
import { createDefaultGroupVisibility } from './groupVisibility';
import { resolveAdjustmentContext } from './resolveAdjustmentContext';
import { GradeInspectorController, projectGradeInspector } from './GradeInspectorController';

const fixture = () => {
  const opening = createImageDocument('Inspector', 32, 24, 'asset');
  const layerId = opening.activeLayerId!;
  const values = { ...createDefaultAdjustments(), exposureEV: 2 };
  const document = addRasterLayerAttachedAdjustment(opening, layerId, {
    id: 'attached-grade', name: 'Grade', adjustmentKind: 'grade', enabled: false,
    revision: 0, adjustmentStack: createAdjustmentStackFromBasicAdjustments(values)
  });
  const target = { kind: 'attached-processing' as const, layerId, adjustmentId: 'attached-grade' };
  return { document, layerId, target, values };
};
const harness = (getContext: () => ReturnType<typeof resolveAdjustmentContext>) => {
  const visibility = createDefaultGroupVisibility();
  const layers = { setVisibility: vi.fn(), setLocalGradeEnabled: vi.fn(),
    setAttachedAdjustmentEnabled: vi.fn(), setGradeGroupEnabled: vi.fn() };
  const publishVisibility = vi.fn();
  return { layers, publishVisibility, visibility, controller: new GradeInspectorController({
    getContext, layers, getVisibility: () => visibility, publishVisibility
  }) };
};

describe('Grade inspector owner resolution', () => {
  it('projects and toggles the attachment, never its raster parent', () => {
    const f = fixture();
    const context = resolveAdjustmentContext(f.document, createDefaultAdjustments(), f.target)!;
    const h = harness(() => context);
    expect(context.ownerId).toBe(attachedAdjustmentOwnerId(f.layerId, 'attached-grade'));
    expect(context.readAdjustments().exposureEV).toBe(2);
    expect(projectGradeInspector(context, h.visibility).masterEnabled).toBe(false);
    h.controller.toggleMaster();
    expect(h.layers.setAttachedAdjustmentEnabled).toHaveBeenCalledWith(f.layerId, 'attached-grade', true);
    expect(h.layers.setLocalGradeEnabled).not.toHaveBeenCalled();
    expect(h.publishVisibility).not.toHaveBeenCalled();
    h.controller.toggleSection('light');
    expect(h.layers.setGradeGroupEnabled).toHaveBeenCalledWith(context.ownerId, 'light', false);
  });

  it('reconciles a deleted attachment before deriving identity, destination and settings', () => {
    const f = fixture();
    const document = removeRasterLayerAttachedAdjustment(f.document, f.layerId, 'attached-grade');
    const context = resolveAdjustmentContext(document, createDefaultAdjustments(), f.target)!;
    expect(context.target).toEqual({ kind: 'layer', layerId: f.layerId });
    expect(context.identity).toBe(JSON.stringify(context.target));
    expect(context.ownerId).toBe(f.layerId);
    expect(context.attachment).toBeNull();
    expect(context.readAdjustments().exposureEV).toBe(0);
  });

  it('reads the current contextual owner for every intent, not the construction target', () => {
    const f = fixture();
    let context = resolveAdjustmentContext(f.document, createDefaultAdjustments(), f.target);
    const h = harness(() => context);
    context = resolveAdjustmentContext(f.document, f.values, { kind: 'document-processing', owner: 'grade' });
    h.controller.toggleMaster();
    h.controller.toggleSection('colorMixer');
    expect(h.publishVisibility).toHaveBeenNthCalledWith(1, { ...h.visibility, globalGrade: false });
    expect(h.publishVisibility).toHaveBeenNthCalledWith(2, { ...h.visibility, colorMixer: false });
    expect(h.layers.setAttachedAdjustmentEnabled).not.toHaveBeenCalled();
    expect(context?.ownerId).toBeNull();
    expect(context?.readAdjustments().exposureEV).toBe(2);
  });

  it('routes a standalone Grade master to layer visibility and a neutral raster to local Grade', () => {
    const f = fixture();
    const document = createAdjustmentLayer(f.document, createAdjustmentStackFromBasicAdjustments(f.values), 'Grade');
    let context = resolveAdjustmentContext(document, createDefaultAdjustments(), f.target);
    const h = harness(() => context);
    h.controller.toggleMaster();
    expect(h.layers.setVisibility).toHaveBeenCalledWith([document.activeLayerId], false);
    context = resolveAdjustmentContext(f.document, createDefaultAdjustments(), { kind: 'layer', layerId: f.layerId });
    h.controller.toggleMaster();
    expect(h.layers.setLocalGradeEnabled).toHaveBeenCalledWith(f.layerId, false);
  });

  it('does not invent an adjustment owner for missing documents or non-processing inspectors', () => {
    const f = fixture();
    expect(resolveAdjustmentContext(null, f.values, f.target)).toBeNull();
    const context = resolveAdjustmentContext(f.document, f.values, { kind: 'style-stack', layerId: f.layerId });
    expect(context).toBeNull();
    const h = harness(() => context);
    h.controller.toggleMaster();
    h.controller.toggleSection('light');
    expect(h.publishVisibility).not.toHaveBeenCalled();
    expect(h.layers.setGradeGroupEnabled).not.toHaveBeenCalled();
  });
});
