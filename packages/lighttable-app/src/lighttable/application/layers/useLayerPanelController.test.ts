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
import {
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
    mergeActiveLayerDown: vi.fn(),
    mergeSelectedRasterLayers: vi.fn(),
    requestFlattenGroup: vi.fn(),
    requestFlattenImage: vi.fn(),
    editStyles: vi.fn()
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
  it('selects an adjustment layer and projects its grade without document effects', () => {
    const base = createImageDocument('test', 100, 100, 'asset');
    const grade = createDefaultAdjustments();
    grade.exposureEV = 1.5;
    grade.effects.grain.enabled = true;
    const document = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments(grade)
    );
    const adjustmentLayerId = document.activeLayerId!;
    const harness = setup(document);
    const documentEffects = harness.dependencies.getDocumentAdjustments().effects;
    documentEffects.lensDistortion.enabled = true;

    harness.controller.select(adjustmentLayerId);

    expect(harness.document().activeLayerId).toBe(adjustmentLayerId);
    expect(harness.panelAdjustments().exposureEV).toBe(1.5);
    expect(harness.panelAdjustments().effects).toEqual(documentEffects);
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(false);
    expect(harness.dependencies.mutateDocument).toHaveBeenCalledWith(
      expect.any(Function),
      false
    );
  });

  it('adds a mask and atomically targets it with a black brush', () => {
    const harness = setup(createImageDocument('test', 100, 100, 'asset'));
    const activeLayerId = harness.document().activeLayerId!;

    harness.controller.addMask();

    expect(findDocumentLayer(harness.document(), activeLayerId)?.mask).not.toBeNull();
    expect(harness.dependencies.setPaintTarget).toHaveBeenCalledWith(
      'mask',
      '#000000'
    );
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
    // Lens/output effects are never smuggled into a local grade stack.
    expect(harness.panelAdjustments().effects.grain.enabled).toBe(true);
    expect(harness.panelAdjustments().effects.halation.enabled).toBe(false);
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
    expect(harness.dependencies.mergeSelectedRasterLayers)
      .toHaveBeenCalledWith(layerIds);
    expect(harness.dependencies.requestFlattenGroup).toHaveBeenCalledWith(groupId);
    expect(harness.dependencies.requestFlattenImage).toHaveBeenCalledOnce();
  });
});
