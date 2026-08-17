import { describe, expect, it, vi } from 'vitest';
import {
  addLayerMask,
  createAdjustmentLayer,
  createRasterLayer,
  setRasterLayerAdjustmentStack
} from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { addLayerStyle } from '../../editor/styles/layerStyleCommands';
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
  const dependencies: LayerPanelControllerDependencies = {
    getDocument: () => document,
    getDocumentAdjustments: () => documentAdjustments,
    mutateDocument: vi.fn((mutate) => {
      document = mutate(document);
    }),
    publishPanelAdjustments: vi.fn((next: BasicAdjustments) => {
      panelAdjustments = cloneAdjustments(next);
    }),
    setPaintTarget: vi.fn(),
    beginDocumentTransaction: vi.fn(),
    endDocumentTransaction: vi.fn(),
    createAdjustmentLayer: vi.fn(),
    createCurvesAdjustmentLayer: vi.fn(),
    createLensFxLayer: vi.fn(),
    createAdjustmentLayerOfKind: vi.fn(),
    createAttachedAdjustment: vi.fn(() => null),
    addActiveLayerMask: vi.fn(() => true),
    duplicateActiveLayer: vi.fn(() => true),
    rasterizeActiveTextLayer: vi.fn(() => true),
    loadLayerMaskSelection: vi.fn(),
    loadLayerTransparencySelection: vi.fn(),
    mergeActiveLayerDown: vi.fn(),
    mergeSelectedLayers: vi.fn(),
    requestFlattenGroup: vi.fn(),
    requestFlattenImage: vi.fn(),
    editStyles: vi.fn(),
    finishStyleEditing: vi.fn(),
    finishProcessingEditing: vi.fn(),
    finishTextEditing: vi.fn()
  };
  const controller = createLayerPanelController(() => dependencies);
  return {
    controller,
    dependencies,
    document: () => document,
    panelAdjustments: () => panelAdjustments
  };
};

describe('createLayerPanelController', () => {
  it('delegates duplicate and fixture text rasterization to the document command owner', () => {
    const state = setup(createImageDocument('test', 100, 100, 'asset'));

    state.controller.duplicateActive();
    state.controller.rasterizeActiveText();

    expect(state.dependencies.duplicateActiveLayer).toHaveBeenCalledOnce();
    expect(state.dependencies.rasterizeActiveTextLayer).toHaveBeenCalledOnce();
    expect(state.dependencies.finishTextEditing).toHaveBeenCalledOnce();
  });

  it('finishes text editing before destructive layer-tree commands', () => {
    let document = createImageDocument('test', 100, 100, 'asset');
    document = createRasterLayer(document, 'Disposable');
    const state = setup(document);
    const active = state.document().activeLayerId!;

    state.controller.deleteSelection([active]);
    state.controller.mergeDown();
    state.controller.mergeSelected([active]);
    state.controller.flattenGroup(active);
    state.controller.flattenImage();

    expect(state.dependencies.finishTextEditing).toHaveBeenCalledTimes(5);
  });

  it('selects an adjustment layer and projects its grade without document effects', () => {
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

    harness.controller.select(adjustmentLayerId);

    expect(harness.document().activeLayerId).toBe(adjustmentLayerId);
    expect(harness.panelAdjustments().exposureEV).toBe(1.5);
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(false);
    expect(harness.panelAdjustments().effects.lensDistortion.enabled).toBe(false);
    expect(harness.dependencies.mutateDocument).toHaveBeenCalledWith(
      expect.any(Function),
      false
    );
  });

  it('adds a mask and atomically targets it with a black brush', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));

    harness.controller.addMask();

    expect(harness.dependencies.addActiveLayerMask).toHaveBeenCalledOnce();
    expect(harness.dependencies.setPaintTarget).toHaveBeenCalledWith(
      'mask',
      '#000000'
    );
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

  it('prepares provisional vector work before changing the active layer', () => {
    let document = createImageDocument('test', 100, 100, 'asset');
    document = createRasterLayer(document, 'First');
    const firstLayerId = document.activeLayerId!;
    document = createRasterLayer(document, 'Second');
    const secondLayerId = document.activeLayerId!;
    document = { ...document, activeLayerId: firstLayerId };
    const harness = setup(document);
    harness.dependencies.prepareActiveLayerChange = vi.fn();

    harness.controller.select(secondLayerId);

    expect(harness.dependencies.prepareActiveLayerChange).toHaveBeenCalledWith(secondLayerId);
    expect(harness.document().activeLayerId).toBe(secondLayerId);
  });

  it('selects a raster layer and projects its attached local grade', () => {
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

    harness.controller.select(document.activeLayerId!);

    expect(harness.panelAdjustments().contrast).toBe(42);
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(false);
    expect(harness.panelAdjustments().effects.halation.enabled).toBe(true);
  });

  it('bypasses and restores a raster layer local grade without losing its settings', () => {
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

    harness.controller.select(layerId);
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

  it('removes one Layer Effect without clearing its siblings', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const layerId = base.activeLayerId!;
    const styled = addLayerStyle(addLayerStyle(base, layerId, 'drop-shadow'), layerId, 'stroke');
    const effects = findDocumentLayer(styled, layerId)!.styleStack.effects;
    const harness = setup(styled);

    harness.controller.removeStyle(layerId, effects[0].id);

    expect(findDocumentLayer(harness.document(), layerId)?.styleStack.effects)
      .toEqual([effects[1]]);
    expect(harness.dependencies.finishStyleEditing).toHaveBeenCalledOnce();
  });

  it('removes the active mask and returns painting to pixels', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const activeLayerId = harness.document().activeLayerId!;
    harness.controller.addMask();

    harness.controller.removeMask();

    expect(findDocumentLayer(harness.document(), activeLayerId)?.mask).toBeNull();
    expect(harness.dependencies.setPaintTarget).toHaveBeenLastCalledWith('pixels');
  });

  it('removes the explicitly dragged mask without depending on the active layer', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const backgroundId = base.activeLayerId!;
    const maskedBackground = addLayerMask(base, backgroundId);
    const harness = setup(createRasterLayer(maskedBackground, 'Top'));

    harness.controller.removeMask(backgroundId);

    expect(findDocumentLayer(harness.document(), backgroundId)?.mask).toBeNull();
    expect(harness.dependencies.setPaintTarget).toHaveBeenLastCalledWith('pixels');
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

  it('delegates destructive and dialog-backed commands without duplicating policy', () => {
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
    expect(harness.dependencies.requestFlattenGroup).toHaveBeenCalledWith(groupId);
    expect(harness.dependencies.requestFlattenImage).toHaveBeenCalledOnce();
  });
});
