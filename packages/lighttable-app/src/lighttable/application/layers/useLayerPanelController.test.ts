import { describe, expect, it, vi } from 'vitest';
import {
  addRasterLayerAttachedAdjustment,
  addLayerMask,
  createAdjustmentLayer,
  createRasterLayer,
  setRasterLayerAdjustmentStack
} from '../../editor/document/documentCommands';
import { createFilterStack } from '../../processing/filter';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { AdjustmentPresentationSynchronizer } from '../adjustments/AdjustmentPresentationSynchronizer';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import { PropertiesInspectorPresentation } from '../properties/PropertiesInspectorPresentation';
import {
  adjustmentStackForOwner,
  adjustmentStackHasLocalProcessing,
  adjustmentStackLocalProcessingIsEnabled,
  adjustmentStackOwnerIsEnabled,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import {
  createLayerPanelController,
  type LayerPanelControllerDependencies
} from './useLayerPanelController';

const setup = (initialDocument: ImageDocument) => {
  let document = initialDocument;
  const documentAdjustments = createDefaultAdjustments();
  let panelAdjustments = createDefaultAdjustments();
  let scopeCurrent = true;
  const properties = new PropertiesInspectorPresentation({
    capture: () => ({ isCurrent: () => scopeCurrent, reveal: vi.fn() }),
    schedule: () => 1, cancel: vi.fn()
  });
  properties.mount();
  properties.show({ kind: 'layer', layerId: document.activeLayerId! });
  const publish = vi.fn((next: BasicAdjustments) => { panelAdjustments = cloneAdjustments(next); });
  const presentation = new AdjustmentPresentationSynchronizer(publish);
  const synchronize = vi.spyOn(presentation, 'synchronize');
  const dependencies: LayerPanelControllerDependencies = {
    getDocument: () => document,
    getDocumentAdjustments: () => documentAdjustments,
    mutateDocument: vi.fn((mutate) => {
      const before = document;
      document = mutate(document);
      return document !== before;
    }),
    presentation,
    getPropertiesTarget: properties.getSnapshot,
    captureSelectionScope: () => ({ isCurrent: () => scopeCurrent }),
    properties,
    reportError: vi.fn(),
    setPaintTarget: vi.fn(),
    beginDocumentTransaction: vi.fn(() => true),
    endDocumentTransaction: vi.fn(() => true),
    cancelDocumentTransaction: vi.fn(() => true),
    createAdjustmentLayer: vi.fn(),
    createCurvesAdjustmentLayer: vi.fn(),
    createLensFxLayer: vi.fn(),
    createAdjustmentLayerOfKind: vi.fn(),
    createAttachedAdjustment: vi.fn(() => null),
    setAttachedFilterEnabled: vi.fn(() => true),
    requestAddLayerMask: vi.fn(),
    requestToggleLayerMask: vi.fn(),
    requestSetLayerMaskLinked: vi.fn(),
    requestRemoveLayerMask: vi.fn(),
    duplicateActiveLayer: vi.fn(() => true),
    rasterizeActiveLayer: vi.fn(async () => true),
    loadLayerMaskSelection: vi.fn(),
    loadLayerTransparencySelection: vi.fn(),
    mergeActiveLayerDown: vi.fn(),
    mergeSelectedLayers: vi.fn(),
    flattenGroup: vi.fn(),
    flattenImage: vi.fn(),
    editStyles: vi.fn(),
    setStyleStackEnabled: vi.fn(),
    setStyleEnabled: vi.fn(),
    removeStyle: vi.fn(),
    clearStyles: vi.fn(),
    finishStyleEditing: vi.fn(),
    finishProcessingEditing: vi.fn(),
    finishTextEditing: vi.fn()
  };
  const controller = createLayerPanelController(() => dependencies);
  return {
    controller,
    dependencies,
    synchronize,
    properties,
    inspect: (next: PropertiesInspectorTarget) => {
      properties.show(next);
      presentation.synchronize(document, documentAdjustments, next);
    },
    retire: () => { scopeCurrent = false; },
    document: () => document,
    panelAdjustments: () => panelAdjustments
  };
};

describe('createLayerPanelController', () => {
  it('delegates finalization terminal ownership without an earlier unscoped text finish', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset')), id = state.document().activeLayerId!;
    state.controller.mergeDown(); state.controller.mergeSelected([id]); state.controller.flattenGroup(id); state.controller.flattenImage();
    expect(state.dependencies.finishTextEditing).not.toHaveBeenCalled();
    expect(state.dependencies.mergeActiveLayerDown).toHaveBeenCalledOnce();
    expect(state.dependencies.mergeSelectedLayers).toHaveBeenCalledWith([id]);
    expect(state.dependencies.flattenGroup).toHaveBeenCalledWith(id); expect(state.dependencies.flattenImage).toHaveBeenCalledOnce();
    state.controller.rasterizeActive(); expect(state.dependencies.finishTextEditing).toHaveBeenCalledOnce();
  });
  it('returns creation IDs captured before a later panel selection change', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset'));
    const openingId = state.document().activeLayerId;
    const mutate = state.dependencies.mutateDocument;
    state.dependencies.mutateDocument = (change, history) => {
      const applied = mutate(change, history);
      mutate(document => ({ ...document, activeLayerId: openingId }), false);
      return applied;
    };
    const gradientId = state.controller.createGradientFillLayer();
    expect(gradientId).not.toBeNull();
    expect(gradientId).not.toBe(state.document().activeLayerId);
    expect(findDocumentLayer(state.document(), gradientId!)?.type).toBe('vector');
    const groupId = state.controller.createGroup();
    expect(findDocumentLayer(state.document(), groupId!)?.type).toBe('group');
    expect(state.dependencies.setPaintTarget).toHaveBeenCalledTimes(2);
  });

  it('does not report a created layer or change channels after rejected admission', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset'));
    state.dependencies.mutateDocument = change => { change(state.document()); return false; };
    expect(state.controller.createGradientFillLayer()).toBeNull();
    expect(state.controller.createGroup()).toBeNull();
    expect(state.controller.groupSelection([state.document().activeLayerId!])).toBeNull();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('reports group IDs from the admitted group result and preserves empty grouping as no-op', () => {
    const state = setup(createRasterLayer(createImageDocument('test', 100, 100, 'asset')));
    const selected = state.document().layers.map(layer => layer.id);
    const groupId = state.controller.groupSelection(selected);
    const group = findDocumentLayer(state.document(), groupId!);
    expect(group?.type).toBe('group');
    if (group?.type === 'group') expect(group.children.map(layer => layer.id)).toEqual(selected);
    vi.mocked(state.dependencies.setPaintTarget).mockClear();
    expect(state.controller.groupSelection([])).toBeNull();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('delegates attached filter visibility to the semantic filter owner', () => {
    let document = createRasterLayer(createImageDocument('test', 100, 100, 'asset'));
    const layerId = document.activeLayerId!;
    document = addRasterLayerAttachedAdjustment(document, layerId, {
      id: 'attached-filter',
      adjustmentKind: 'gaussian-blur',
      name: 'Gaussian Blur',
      enabled: true,
      revision: 0,
      adjustmentStack: createFilterStack('gaussian-blur')
    });
    const state = setup(document);
    state.controller.setAttachedAdjustmentEnabled(layerId, 'attached-filter', false);
    expect(state.dependencies.setAttachedFilterEnabled)
      .toHaveBeenCalledWith(layerId, 'attached-filter', false);
    expect(state.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('delegates style mutations without owning a document fallback', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset'));
    state.controller.setStyleStackEnabled('layer' as never, false);
    state.controller.setStyleEnabled('layer' as never, 'effect' as never, false);
    state.controller.removeStyle('layer' as never, 'effect' as never);
    state.controller.clearStyles('layer' as never);
    expect(state.dependencies.setStyleStackEnabled).toHaveBeenCalledWith('layer', false);
    expect(state.dependencies.setStyleEnabled).toHaveBeenCalledWith('layer', 'effect', false);
    expect(state.dependencies.removeStyle).toHaveBeenCalledWith('layer', 'effect');
    expect(state.dependencies.clearStyles).toHaveBeenCalledWith('layer');
    expect(state.dependencies.finishStyleEditing).toHaveBeenCalledTimes(2);
    expect(state.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('delegates duplicate and rasterization to the document command owner', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset'));

    state.controller.duplicateActive();
    state.controller.rasterizeActive();

    expect(state.dependencies.duplicateActiveLayer).toHaveBeenCalledOnce();
    expect(state.dependencies.rasterizeActiveLayer).toHaveBeenCalledOnce();
    expect(state.dependencies.finishTextEditing).toHaveBeenCalledOnce();
  });

  it('keeps the existing text prerequisite for delete while finalization delegates its own scoped preparation', () => {
    let document = createImageDocument('test', 100, 100, 'asset');
    document = createRasterLayer(document, 'Disposable');
    const state = setup(document);
    const active = state.document().activeLayerId!;

    state.controller.deleteSelection([active]);
    state.controller.mergeDown();
    state.controller.mergeSelected([active]);
    state.controller.flattenGroup(active);
    state.controller.flattenImage();

    expect(state.dependencies.finishTextEditing).toHaveBeenCalledOnce();
  });

  it('selects an adjustment layer and projects its grade without document effects', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const grade = createDefaultAdjustments();
    grade.exposureEV = 1.5;
    grade.effects.grain.enabled = true;
    const document = createAdjustmentLayer(
      base,
      adjustmentStackForOwner(
        createAdjustmentStackFromBasicAdjustments(grade),
        'grade'
      )
    );
    const adjustmentLayerId = document.activeLayerId!;
    const harness = setup(document);
    const documentEffects = harness.dependencies.getDocumentAdjustments().effects;
    documentEffects.lensDistortion.enabled = true;

    await harness.controller.select(adjustmentLayerId);

    expect(harness.document().activeLayerId).toBe(adjustmentLayerId);
    expect(harness.panelAdjustments().exposureEV).toBe(1.5);
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(false);
    expect(harness.panelAdjustments().effects.lensDistortion.enabled).toBe(false);
    expect(harness.dependencies.mutateDocument).toHaveBeenCalledWith(
      expect.any(Function),
      false
    );
  });

  it('delegates adding a mask to the semantic mask command owner', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));

    harness.controller.addMask();

    expect(harness.dependencies.requestAddLayerMask).toHaveBeenCalledOnce();
    expect(harness.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('delegates loading a mask selection without changing the paint target', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const activeLayerId = harness.document().activeLayerId!;

    harness.controller.loadMaskSelection(activeLayerId);

    expect(harness.dependencies.loadLayerMaskSelection).toHaveBeenCalledWith(activeLayerId);
    expect(harness.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('delegates loading raster transparency without changing the active paint target', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const activeLayerId = harness.document().activeLayerId!;

    harness.controller.loadTransparencySelection(activeLayerId);

    expect(harness.dependencies.loadLayerTransparencySelection).toHaveBeenCalledWith(activeLayerId);
    expect(harness.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('delegates mask metadata changes without a direct document mutation path', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const layerId = harness.document().activeLayerId!;

    harness.controller.toggleMask();
    harness.controller.setMaskLinked(layerId, false);

    expect(harness.dependencies.requestToggleLayerMask).toHaveBeenCalledOnce();
    expect(harness.dependencies.requestSetLayerMaskLinked).toHaveBeenCalledWith(layerId, false);
    expect(harness.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('prepares provisional vector work before changing the active layer', async () => {
    let document = createImageDocument('test', 100, 100, 'asset');
    document = createRasterLayer(document, 'First');
    const firstLayerId = document.activeLayerId!;
    document = createRasterLayer(document, 'Second');
    const secondLayerId = document.activeLayerId!;
    document = { ...document, activeLayerId: firstLayerId };
    const harness = setup(document);
    harness.dependencies.prepareActiveLayerChange = vi.fn();

    await harness.controller.select(secondLayerId);

    expect(harness.dependencies.prepareActiveLayerChange).toHaveBeenCalledWith(secondLayerId, expect.any(Function));
    expect(harness.document().activeLayerId).toBe(secondLayerId);
  });

  it('keeps the exact child inspector baseline when parent selection finishes after the child opened', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const layerId = base.activeLayerId!;
    let document = setRasterLayerAdjustmentStack(base, layerId,
      createAdjustmentStackFromBasicAdjustments({ ...createDefaultAdjustments(), exposureEV: -0.5 }));
    for (const [id, exposureEV] of [['first', 0], ['second', 2]] as const) {
      document = addRasterLayerAttachedAdjustment(document, layerId, {
        id, name: id, adjustmentKind: 'grade', enabled: true, revision: 0,
        adjustmentStack: createAdjustmentStackFromBasicAdjustments({ ...createDefaultAdjustments(), exposureEV })
      });
    }
    const state = setup(document);
    let release!: () => void;
    state.dependencies.prepareActiveLayerChange = () => new Promise<void>(resolve => { release = resolve; });
    state.inspect({ kind: 'layer', layerId });
    expect(state.panelAdjustments().exposureEV).toBe(-0.5);
    const selecting = state.controller.select(layerId);
    state.inspect({ kind: 'attached-processing', layerId, adjustmentId: 'first' });
    expect(state.panelAdjustments().exposureEV).toBe(0);
    release(); await selecting;
    expect(state.panelAdjustments().exposureEV).toBe(0);

    const siblingSelection = state.controller.select(layerId);
    state.inspect({ kind: 'attached-processing', layerId, adjustmentId: 'second' });
    release(); await siblingSelection;
    expect(state.panelAdjustments().exposureEV).toBe(2);

    const parentSelection = state.controller.select(layerId);
    state.inspect({ kind: 'layer', layerId });
    release(); await parentSelection;
    expect(state.panelAdjustments().exposureEV).toBe(-0.5);
  });

  it('does not let an ordinary delayed panel selection publish into a retired same-ID context', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const state = setup(createRasterLayer(base, 'Second'));
    let release!: () => void;
    state.dependencies.prepareActiveLayerChange = () => new Promise<void>(resolve => { release = resolve; });
    const pending = state.controller.select(base.activeLayerId!);
    state.retire();
    release(); await pending;
    expect(state.document().activeLayerId).not.toBe(base.activeLayerId);
    expect(state.dependencies.mutateDocument).not.toHaveBeenCalled();
    expect(state.synchronize).not.toHaveBeenCalled();
  });

  it.each([false, true])('opens an attached inspector only at admitted parent selection (different parent: %s)', async differentParent => {
    let document = createImageDocument('test', 100, 100, 'asset');
    const layerId = document.activeLayerId!;
    document = setRasterLayerAdjustmentStack(document, layerId,
      createAdjustmentStackFromBasicAdjustments({ ...createDefaultAdjustments(), exposureEV: -0.5 }));
    document = addRasterLayerAttachedAdjustment(document, layerId, {
      id: 'neutral', name: 'Grade', adjustmentKind: 'grade', enabled: true, revision: 0,
      adjustmentStack: createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    });
    if (differentParent) {
      document = createRasterLayer(document, 'Other');
      document = setRasterLayerAdjustmentStack(document, document.activeLayerId!,
        createAdjustmentStackFromBasicAdjustments({ ...createDefaultAdjustments(), exposureEV: 3 }));
    }
    const state = setup(document), openingTarget = state.properties.getSnapshot();
    state.inspect(openingTarget);
    let release!: () => void;
    state.dependencies.prepareActiveLayerChange = () => new Promise<void>(resolve => { release = resolve; });
    const pending = state.controller.inspectAttachedAdjustment(layerId, 'neutral');
    expect(state.properties.getSnapshot()).toEqual(openingTarget);
    expect(state.panelAdjustments().exposureEV).toBe(differentParent ? 3 : -0.5);
    release(); await pending;
    expect(state.document().activeLayerId).toBe(layerId);
    expect(state.properties.getSnapshot()).toEqual({ kind: 'attached-processing', layerId, adjustmentId: 'neutral' });
    expect(state.panelAdjustments().exposureEV).toBe(0);
    expect(state.dependencies.setPaintTarget).toHaveBeenCalledExactlyOnceWith('pixels');
    expect(state.dependencies.reportError).not.toHaveBeenCalled();
  });

  it.each(['sibling', 'row', 'canvas', 'retired'] as const)('does not reopen an attached inspector after a newer %s intent', async next => {
    let document = createImageDocument('test', 100, 100, 'asset');
    const layerId = document.activeLayerId!;
    for (const [id, exposureEV] of [['first', 0], ['second', 2]] as const) {
      document = addRasterLayerAttachedAdjustment(document, layerId, {
        id, name: id, adjustmentKind: 'grade', enabled: true, revision: 0,
        adjustmentStack: createAdjustmentStackFromBasicAdjustments({ ...createDefaultAdjustments(), exposureEV })
      });
    }
    const state = setup(createRasterLayer(document, 'Other'));
    const otherId = state.document().activeLayerId!;
    const releases: (() => void)[] = [];
    state.dependencies.prepareActiveLayerChange = () => new Promise<void>(resolve => { releases.push(resolve); });
    const first = state.controller.inspectAttachedAdjustment(layerId, 'first');
    let second: Promise<void> | undefined;
    if (next === 'sibling') second = state.controller.inspectAttachedAdjustment(layerId, 'second');
    else if (next === 'row') {
      second = state.controller.select(otherId);
      state.inspect({ kind: 'layer', layerId: otherId });
    } else if (next === 'canvas') second = state.controller.select(otherId);
    else state.retire();
    releases[0]!(); await first;
    expect(state.document().activeLayerId).toBe(otherId);
    expect(state.properties.getSnapshot()).toEqual({ kind: 'layer', layerId: otherId });
    if (second) { releases[1]!(); await second; }
    expect(state.properties.getSnapshot()).toEqual(next === 'sibling'
      ? { kind: 'attached-processing', layerId, adjustmentId: 'second' }
      : { kind: 'layer', layerId: otherId });
    expect(state.dependencies.reportError).not.toHaveBeenCalled();
  });

  it('reports rejected attached selection without showing its target or publishing its values', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const withChild = addRasterLayerAttachedAdjustment(base, base.activeLayerId!, {
      id: 'child', name: 'Grade', adjustmentKind: 'grade', enabled: true, revision: 0,
      adjustmentStack: createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    });
    const state = setup(createRasterLayer(withChild, 'Other'));
    const opening = state.properties.getSnapshot();
    state.dependencies.mutateDocument = () => false;
    await state.controller.inspectAttachedAdjustment(base.activeLayerId!, 'child');
    expect(state.properties.getSnapshot()).toEqual(opening);
    expect(state.synchronize).not.toHaveBeenCalled();
    expect(state.dependencies.reportError).toHaveBeenCalledOnce();
  });

  it('rejects an attachment removed during preparation before selecting its parent', async () => {
    const base = createImageDocument('test', 100, 100, 'asset'), layerId = base.activeLayerId!;
    const withChild = addRasterLayerAttachedAdjustment(base, layerId, {
      id: 'removed', name: 'Grade', adjustmentKind: 'grade', enabled: true, revision: 0,
      adjustmentStack: createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    });
    const state = setup(createRasterLayer(withChild, 'Other')), otherId = state.document().activeLayerId;
    state.dependencies.prepareActiveLayerChange = async () => { state.controller.removeAttachedAdjustment(layerId, 'removed'); };
    const pending = state.controller.inspectAttachedAdjustment(layerId, 'removed');
    await pending;
    expect(state.document().activeLayerId).toBe(otherId);
    expect(state.synchronize).not.toHaveBeenCalled();
    expect(state.dependencies.reportError).toHaveBeenCalledOnce();
  });

  it('does not replace the active layer until asynchronous preparation completes', async () => {
    let document = createImageDocument('test', 100, 100, 'asset');
    const firstLayerId = document.activeLayerId!;
    document = createRasterLayer(document, 'Second');
    const secondLayerId = document.activeLayerId!;
    document = { ...document, activeLayerId: firstLayerId };
    const harness = setup(document);
    let release!: () => void;
    harness.dependencies.prepareActiveLayerChange = () => new Promise<void>((resolve) => {
      release = resolve;
    });

    const selecting = harness.controller.select(secondLayerId);
    expect(harness.document().activeLayerId).toBe(firstLayerId);
    release();
    await selecting;
    expect(harness.document().activeLayerId).toBe(secondLayerId);
  });

  it.each(['request', 'document'] as const)('rejects a retired %s after selection preparation', async kind => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const next = createRasterLayer(base, 'Second');
    const harness = setup({ ...next, activeLayerId: base.activeLayerId });
    let current = true;
    let release!: () => void;
    const guard = () => current;
    harness.dependencies.prepareActiveLayerChange = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const onSelected = vi.fn();
    const pending = harness.controller.selectIfCurrent(next.activeLayerId!, guard, onSelected);
    if (kind === 'request') current = false;
    else harness.dependencies.mutateDocument(doc => ({ ...doc, id: 'replacement' as never }), false);
    vi.mocked(harness.dependencies.mutateDocument).mockClear();
    release();
    expect(await pending).toBe(false);
    expect(harness.dependencies.prepareActiveLayerChange).toHaveBeenCalledWith(next.activeLayerId, expect.any(Function));
    expect(harness.dependencies.mutateDocument).not.toHaveBeenCalled();
    expect(harness.synchronize).not.toHaveBeenCalled();
    expect(harness.document().activeLayerId).toBe(base.activeLayerId);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('guards at mutation admission, not only when preparation returns', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const next = createRasterLayer(base, 'Second');
    const harness = setup({ ...next, activeLayerId: base.activeLayerId });
    let current = true;
    const mutate = harness.dependencies.mutateDocument;
    harness.dependencies.mutateDocument = (change, history) => { current = false; return mutate(change, history); };
    const onSelected = vi.fn();
    expect(await harness.controller.selectIfCurrent(next.activeLayerId!, () => current, onSelected)).toBe(false);
    expect(harness.document().activeLayerId).toBe(base.activeLayerId);
    expect(harness.synchronize).not.toHaveBeenCalled();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('does not project rejected selection but admits an already-active no-op', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const next = createRasterLayer(base, 'Second');
    const harness = setup({ ...next, activeLayerId: base.activeLayerId });
    harness.dependencies.mutateDocument = () => false;
    const onSelected = vi.fn();
    expect(await harness.controller.selectIfCurrent(next.activeLayerId!, () => true, onSelected)).toBe(false);
    expect(onSelected).not.toHaveBeenCalled();
    expect(harness.synchronize).not.toHaveBeenCalled();
    expect(await harness.controller.selectIfCurrent(base.activeLayerId!, () => true, onSelected)).toBe(true);
    expect(onSelected).toHaveBeenCalledOnce();
    expect(harness.synchronize).toHaveBeenCalledOnce();
  });

  it('preserves the document revision committed by selection preparation', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const next = createRasterLayer(base, 'Second');
    const harness = setup({ ...next, activeLayerId: base.activeLayerId });
    harness.dependencies.prepareActiveLayerChange = async () => {
      harness.dependencies.mutateDocument(doc => ({ ...doc, name: 'Committed preview' }), false);
    };
    expect(await harness.controller.selectIfCurrent(next.activeLayerId!, () => true, () => undefined)).toBe(true);
    expect(harness.document().name).toBe('Committed preview');
    expect(harness.document().activeLayerId).toBe(next.activeLayerId);
  });

  it('publishes admitted row selection before a queued active-layer projection can reconcile it', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const next = createRasterLayer(base, 'Second');
    const harness = setup({ ...next, activeLayerId: base.activeLayerId });
    let selected = [base.activeLayerId!];
    const projectedSelections: string[][] = [];
    const mutate = harness.dependencies.mutateDocument;
    harness.dependencies.mutateDocument = (change, history) => {
      const accepted = mutate(change, history);
      queueMicrotask(() => { projectedSelections.push([...selected]); });
      return accepted;
    };
    const target = next.activeLayerId!;
    await harness.controller.selectIfCurrent(target, () => true, () => {
      expect(harness.document().activeLayerId).toBe(target);
      selected = [base.activeLayerId!, target];
    });
    expect(projectedSelections).toEqual([[base.activeLayerId, target]]);
  });

  it('selects a raster layer and projects its attached local grade', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const local = createDefaultAdjustments();
    local.contrast = 42;
    local.effects.halation.enabled = true;
    const document = setRasterLayerAdjustmentStack(
      base,
      base.activeLayerId!,
      createAdjustmentStackFromBasicAdjustments(local)
    );
    const harness = setup(document);
    harness.dependencies.getDocumentAdjustments().effects.grain.enabled = true;

    await harness.controller.select(document.activeLayerId!);

    expect(harness.panelAdjustments().contrast).toBe(42);
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(false);
    expect(harness.panelAdjustments().effects.halation.enabled).toBe(true);
  });

  it('bypasses and restores a raster layer local grade without losing its settings', async () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const local = createDefaultAdjustments();
    local.contrast = 42;
    const document = setRasterLayerAdjustmentStack(
      base,
      base.activeLayerId!,
      createAdjustmentStackFromBasicAdjustments(local)
    );
    const harness = setup(document);
    const layerId = document.activeLayerId!;

    harness.controller.setLocalGradeEnabled(layerId, false);
    const bypassed = findDocumentLayer(harness.document(), layerId);
    expect(
      bypassed?.type === 'raster'
      && bypassed.adjustmentStack
      && !adjustmentStackLocalProcessingIsEnabled(bypassed.adjustmentStack, 'grade')
      && adjustmentStackLocalProcessingIsEnabled(bypassed.adjustmentStack, 'curves')
      && adjustmentStackOwnerIsEnabled(bypassed.adjustmentStack, 'lens-fx')
    ).toBe(true);

    await harness.controller.select(layerId);
    expect(harness.panelAdjustments().contrast).toBe(42);

    harness.controller.setLocalGradeEnabled(layerId, true);
    const restored = findDocumentLayer(harness.document(), layerId);
    expect(
      restored?.type === 'raster'
      && restored.adjustmentStack
      && adjustmentStackLocalProcessingIsEnabled(restored.adjustmentStack, 'grade')
      && adjustmentStackOwnerIsEnabled(restored.adjustmentStack, 'lens-fx')
    ).toBe(true);
  });

  it('can bypass a neutral Local Grade before its first authored change', () => {
    const document = createImageDocument('test', 100, 100, 'asset');
    const harness = setup(document);
    const layerId = document.activeLayerId!;

    harness.controller.setLocalGradeEnabled(layerId, false);
    const layer = findDocumentLayer(harness.document(), layerId);

    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'grade')
        && !adjustmentStackLocalProcessingIsEnabled(layer.adjustmentStack, 'grade')
      : false).toBe(true);
  });

  it('creates a neutral attached Curves node without manufacturing local Grade', () => {
    const document = createImageDocument('test', 100, 100, 'asset');
    const harness = setup(document);
    const layerId = document.activeLayerId!;

    harness.controller.createLocalProcessing(layerId, 'curves');
    const layer = findDocumentLayer(harness.document(), layerId);

    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')
      : false).toBe(true);
    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'grade')
      : true).toBe(false);
  });

  it('bypasses attached Lens Fx without disabling the attached Grade', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const local = createDefaultAdjustments();
    local.contrast = 42;
    local.effects.lensDistortion.enabled = true;
    const document = setRasterLayerAdjustmentStack(
      base,
      base.activeLayerId!,
      createAdjustmentStackFromBasicAdjustments(local)
    );
    const harness = setup(document);
    const layerId = document.activeLayerId!;

    harness.controller.setLocalLensFxEnabled(layerId, false);
    const bypassed = findDocumentLayer(harness.document(), layerId);

    expect(
      bypassed?.type === 'raster'
      && bypassed.adjustmentStack
      && adjustmentStackOwnerIsEnabled(bypassed.adjustmentStack, 'grade')
      && !adjustmentStackOwnerIsEnabled(bypassed.adjustmentStack, 'lens-fx')
    ).toBe(true);
  });

  it('removes local Grade without deleting attached Lens Fx', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const local = createDefaultAdjustments();
    local.contrast = 42;
    local.effects.lensBlur.enabled = true;
    const document = setRasterLayerAdjustmentStack(
      base,
      base.activeLayerId!,
      createAdjustmentStackFromBasicAdjustments(local)
    );
    const harness = setup(document);
    const layerId = document.activeLayerId!;

    harness.controller.removeLocalProcessing(layerId, 'grade');
    const layer = findDocumentLayer(harness.document(), layerId);

    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'grade')
      : true).toBe(false);
    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')
      : false).toBe(true);
    expect(layer?.type === 'raster' && layer.adjustmentStack
      ? adjustmentStackForOwner(layer.adjustmentStack, 'lens-fx').modules.length
      : 0).toBeGreaterThan(0);
    expect(harness.dependencies.finishProcessingEditing).toHaveBeenCalledOnce();
  });

  it('delegates active-mask removal without a document fallback', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const activeLayerId = harness.document().activeLayerId!;
    harness.controller.removeMask();

    expect(harness.dependencies.requestRemoveLayerMask).toHaveBeenCalledWith(undefined);
    expect(findDocumentLayer(harness.document(), activeLayerId)?.mask).toBeNull();
    expect(harness.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('delegates explicitly targeted mask removal to the semantic owner', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const backgroundId = base.activeLayerId!;
    const maskedBackground = addLayerMask(base, backgroundId);
    const harness = setup(createRasterLayer(maskedBackground, 'Top'));

    harness.controller.removeMask(backgroundId);

    expect(harness.dependencies.requestRemoveLayerMask).toHaveBeenCalledWith(backgroundId);
    expect(findDocumentLayer(harness.document(), backgroundId)?.mask).not.toBeNull();
    expect(harness.dependencies.mutateDocument).not.toHaveBeenCalled();
  });

  it('moves the active layer in document compositing order', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const withMiddle = createRasterLayer(base, 'Middle');
    const harness = setup(createRasterLayer(withMiddle, 'Top'));

    harness.controller.moveActive('down');
    expect(harness.document().layers.map((layer) => layer.name))
      .toEqual(['Background', 'Top', 'Middle']);

    harness.controller.moveActive('up');
    expect(harness.document().layers.map((layer) => layer.name))
      .toEqual(['Background', 'Middle', 'Top']);
  });

  it('owns menu-equivalent visibility, clipping and lock mutations', () => {
    const harness = setup(createRasterLayer(
      createImageDocument('test', 100, 100, 'asset'),
      'Paint'
    ));
    const activeLayerId = harness.document().activeLayerId!;

    harness.controller.setVisibility([activeLayerId], false);
    harness.controller.setClipping(activeLayerId, true);
    harness.controller.setLock([activeLayerId], 'all', true);

    expect(findDocumentLayer(harness.document(), activeLayerId)).toMatchObject({
      visible: false,
      clipping: true,
      locks: { all: true }
    });
  });

  it('admits gesture previews only when the document transaction is owned', () => {
    const admitted = setup(createImageDocument('test', 100, 100, 'asset'));
    expect(admitted.controller.beginVisibilityInteraction()).toBe(true);
    admitted.controller.endVisibilityInteraction();
    expect(admitted.dependencies.endDocumentTransaction).toHaveBeenCalledOnce();

    const rejected = setup(createImageDocument('test', 100, 100, 'asset'));
    vi.mocked(rejected.dependencies.beginDocumentTransaction).mockReturnValue(false);
    expect(rejected.controller.beginOpacityInteraction()).toBe(false);
    rejected.controller.endOpacityInteraction();
    expect(rejected.dependencies.endDocumentTransaction).not.toHaveBeenCalled();
  });

  it('returns structural layer operations to the pixel channel', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));

    harness.controller.createRasterLayer();
    const createdId = harness.document().activeLayerId!;
    expect(findDocumentLayer(harness.document(), createdId)?.type).toBe('raster');
    expect(harness.dependencies.setPaintTarget).toHaveBeenLastCalledWith('pixels');

    harness.controller.deleteSelection([createdId]);
    expect(findDocumentLayer(harness.document(), createdId)).toBeNull();
    expect(harness.dependencies.setPaintTarget).toHaveBeenLastCalledWith('pixels');
  });

  it('delegates undoable merge and flatten commands without confirmation UI', () => {
    const harness = setup(createRasterLayer(
      createImageDocument('test', 100, 100, 'asset')
    ));
    const layerIds = harness.document().layers.map((layer) => layer.id);
    const groupId = layerIds[0];

    harness.controller.mergeDown();
    harness.controller.mergeSelected(layerIds);
    harness.controller.flattenGroup(groupId);
    harness.controller.flattenImage();

    expect(harness.dependencies.mergeActiveLayerDown).toHaveBeenCalledOnce();
    expect(harness.dependencies.mergeSelectedLayers)
      .toHaveBeenCalledWith(layerIds);
    expect(harness.dependencies.flattenGroup).toHaveBeenCalledWith(groupId);
    expect(harness.dependencies.flattenImage).toHaveBeenCalledOnce();
  });
});
