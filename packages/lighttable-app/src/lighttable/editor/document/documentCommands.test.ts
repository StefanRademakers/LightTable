import { describe, expect, it } from 'vitest';
import { createImageDocument } from './documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  addLayerMask,
  applyTranslationAlignment,
  createAdjustmentLayer,
  createGroupLayer,
  createRasterLayer,
  deleteLayers,
  deleteLayer,
  duplicateLayer,
  flattenGroup,
  flattenImage,
  getMergeLayersPlan,
  groupLayers,
  mergeLayerDown,
  mergeLayers,
  moveLayer,
  moveLayerIntoGroup,
  moveLayerRelative,
  moveLayerSelection,
  renameLayer,
  removeLayerMask,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerLock,
  setLayerLocked,
  setLayerMaskProperties,
  setLayerOpacity,
  setLayerTransform,
  setLayerVisibility,
  setLayersLock,
  setLayersVisibility,
  ungroupLayers
} from './documentCommands';
import { translationMatrix } from '../tools/transform/affine';
import {
  findDocumentLayer,
  findRasterLayer,
  rasterLayersForComposite,
  siblingLayers
} from './layerTree';
import { addLayerStyle } from '../styles/layerStyleCommands';

describe('LightTable document commands', () => {
  it('updates mask density and feather as one canonical mask revision', () => {
    const source = createImageDocument('Masked', 100, 50, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const updated = setLayerMaskProperties(masked, layerId, { density: 0.35, feather: 12.5 });
    const mask = findDocumentLayer(updated, layerId)?.mask;

    expect(mask).toMatchObject({ density: 0.35, feather: 12.5, revision: 1 });
  });

  it('keeps bottom-to-top ordering and stable ids', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withPaint = createRasterLayer(base, 'Paint');
    const paintId = withPaint.activeLayerId!;
    const moved = moveLayer(withPaint, paintId, 0);
    expect(moved.layers[0].id).toBe(paintId);
    expect(moved.layers[1].id).toBe(base.layers[0].id);
  });

  it('moves a bottom layer to the requested final top index', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const middle = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(middle, 'Top');
    const backgroundId = base.layers[0].id;

    const moved = moveLayer(document, backgroundId, 2);

    expect(moved.layers.map((layer) => layer.name)).toEqual(['Middle', 'Top', 'Background']);
  });

  it('reorders layers above or below another layer using panel semantics', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withMiddle = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(withMiddle, 'Top');
    const [background, middle, top] = document.layers;

    const backgroundAboveTop = moveLayerRelative(document, background.id, top.id, 'above');
    expect(backgroundAboveTop.layers.map((layer) => layer.id)).toEqual([
      middle.id,
      top.id,
      background.id
    ]);
    expect(backgroundAboveTop.activeLayerId).toBe(top.id);

    const topBelowMiddle = moveLayerRelative(document, top.id, middle.id, 'below');
    expect(topBelowMiddle.layers.map((layer) => layer.id)).toEqual([
      background.id,
      top.id,
      middle.id
    ]);
  });

  it('does not revise the document for a no-op relative reorder', () => {
    const document = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'), 'Top');
    const [background, top] = document.layers;

    expect(moveLayerRelative(document, top.id, background.id, 'above')).toBe(document);
    expect(moveLayerRelative(document, top.id, top.id, 'below')).toBe(document);
  });

  it('inserts a new raster layer directly above a requested layer', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const first = createRasterLayer(base, 'Top');
    const inserted = createRasterLayer(first, 'Pasted Selection', base.layers[0].id);
    expect(inserted.layers.map((layer) => layer.name)).toEqual([
      'Background',
      'Pasted Selection',
      'Top'
    ]);
    expect(inserted.activeLayerId).toBe(inserted.layers[1].id);
  });

  it('creates pass-through groups and moves layers into and out of them', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withPaint = createRasterLayer(base, 'Paint');
    const paintId = withPaint.activeLayerId!;
    const withGroup = createGroupLayer(withPaint, 'Retouch');
    const groupId = withGroup.activeLayerId!;

    const grouped = moveLayerIntoGroup(withGroup, paintId, groupId);
    const group = findDocumentLayer(grouped, groupId);

    expect(group).toMatchObject({ type: 'group', name: 'Retouch', compositing: 'pass-through' });
    expect(group?.type === 'group' ? group.children.map((layer) => layer.id) : []).toEqual([paintId]);
    expect(siblingLayers(grouped, paintId).map((layer) => layer.id)).toEqual([paintId]);

    const movedOut = moveLayerRelative(grouped, paintId, groupId, 'above');
    expect(movedOut.layers.map((layer) => layer.id)).toEqual([
      base.layers[0].id,
      groupId,
      paintId
    ]);
  });

  it('hides group descendants in the raster compositor projection', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withPaint = createRasterLayer(base, 'Paint');
    const paintId = withPaint.activeLayerId!;
    const withGroup = createGroupLayer(withPaint, 'Retouch');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, paintId, groupId);

    const hidden = setLayerVisibility(grouped, groupId, false);
    const projection = rasterLayersForComposite(hidden);

    expect(projection.find((layer) => layer.id === paintId)?.visible).toBe(false);
    expect(findRasterLayer(hidden, base.layers[0].id)?.visible).toBe(true);
  });

  it('updates layer metadata without mutating the source document', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const id = base.layers[0].id;
    const renamed = renameLayer(base, id, 'Plate');
    const hidden = setLayerVisibility(renamed, id, false);
    const faded = setLayerOpacity(hidden, id, 0.4);
    expect(base.layers[0].name).toBe('Background');
    expect(faded.layers[0]).toMatchObject({ name: 'Plate', visible: false, opacity: 0.4 });
  });

  it('does not delete the final layer', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    expect(deleteLayer(base, base.layers[0].id)).toBe(base);
  });

  it('stores blend modes and masks as document semantics', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const id = base.layers[0].id;
    const masked = addLayerMask(setLayerBlendMode(base, id, 'multiply'), id);
    expect(masked.layers[0].blendMode).toBe('multiply');
    expect(masked.layers[0].mask?.enabled).toBe(true);
    expect(removeLayerMask(masked, id).layers[0].mask).toBeNull();
  });

  it('stores Photoshop-compatible common layer semantics independently', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const id = base.layers[0].id;
    const filled = setLayerFillOpacity(base, id, 0.35);
    const clipped = setLayerClipping(filled, id, true);
    const pixelLocked = setLayerLock(clipped, id, 'pixels', true);
    const fullyLocked = setLayerLocked(pixelLocked, id, true);

    expect(base.layers[0]).toMatchObject({
      opacity: 1,
      fillOpacity: 1,
      clipping: false,
      locks: { transparency: false, pixels: false, position: false, all: false }
    });
    expect(fullyLocked.layers[0]).toMatchObject({
      opacity: 1,
      fillOpacity: 0.35,
      clipping: true,
      locks: { transparency: false, pixels: true, position: false, all: true }
    });
  });

  it('duplicates above the source and merges the active layer down', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const duplicated = duplicateLayer(base, base.layers[0].id);
    expect(duplicated.layers).toHaveLength(2);
    expect(duplicated.layers[1].id).not.toBe(base.layers[0].id);
    const merged = mergeLayerDown(duplicated, duplicated.layers[1].id);
    expect(merged.layers).toHaveLength(1);
    expect(merged.layers[0]).toMatchObject({ opacity: 1, blendMode: 'normal', mask: null });
  });

  it('merges a contiguous raster selection and rejects appearance-changing selections', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const middle = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(middle, 'Top');
    const [background, middleLayer, top] = document.layers;

    const merged = mergeLayers(document, [top.id, middleLayer.id]);
    expect(merged.layers.map((layer) => layer.id)).toEqual([background.id, middleLayer.id]);
    expect(merged.layers[1]).toMatchObject({
      id: middleLayer.id,
      name: 'Top',
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      mask: null
    });
    expect(merged.activeLayerId).toBe(middleLayer.id);

    expect(mergeLayers(document, [background.id, top.id])).toBe(document);
    const grouped = createGroupLayer(document, 'Group');
    expect(mergeLayers(grouped, [top.id, grouped.activeLayerId!])).toBe(grouped);
  });

  it('plans multi-layer merges in document order regardless of selection order', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withMiddle = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(withMiddle, 'Top');
    const [background, middle, top] = document.layers;

    expect(getMergeLayersPlan(document, [top.id, background.id, middle.id])).toEqual({
      destinationId: background.id,
      layerIds: [background.id, middle.id, top.id],
      name: top.name
    });
  });

  it('moves, hides, locks and deletes a multi-layer selection as one command', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const middleDocument = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(middleDocument, 'Top');
    const [background, middle, top] = document.layers;

    const moved = moveLayerSelection(document, [middle.id, top.id], background.id, 'below');
    expect(moved.layers.map((layer) => layer.name)).toEqual(['Middle', 'Top', 'Background']);

    const hidden = setLayersVisibility(document, [middle.id, top.id], false);
    expect(hidden.layers.map((layer) => layer.visible)).toEqual([true, false, false]);

    const locked = setLayersLock(document, [middle.id, top.id], 'position', true);
    expect(locked.layers.map((layer) => layer.locks.position)).toEqual([false, true, true]);

    const deleted = deleteLayers(document, [middle.id, top.id]);
    expect(deleted.layers.map((layer) => layer.id)).toEqual([background.id]);
  });

  it('groups and ungroups sibling selections without changing their stacking order', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const middleDocument = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(middleDocument, 'Top');
    const [, middle, top] = document.layers;
    const grouped = groupLayers(document, [middle.id, top.id], 'Pair');
    const group = grouped.layers[1];

    expect(group.type).toBe('group');
    expect(group.type === 'group' ? group.children.map((layer) => layer.name) : [])
      .toEqual(['Middle', 'Top']);

    const ungrouped = ungroupLayers(grouped, [group.id]);
    expect(ungrouped.layers.map((layer) => layer.name))
      .toEqual(['Background', 'Middle', 'Top']);
  });

  it('normalizes parent-and-child structural selections', () => {
    const base = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'), 'Paint');
    const paint = base.layers[1];
    const withGroup = createGroupLayer(base, 'Group');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, paint.id, groupId);

    const deleted = deleteLayers(grouped, [groupId, paint.id]);
    expect(deleted.layers.map((layer) => layer.name)).toEqual(['Background']);
  });

  it('moves and groups an adjustment node like every other layer node', () => {
    const base = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'), 'Paint');
    const paint = base.layers[1];
    const withGrade = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade'
    );
    const gradeId = withGrade.activeLayerId!;

    const moved = moveLayerSelection(withGrade, [gradeId], paint.id, 'below');
    expect(moved.layers.map((layer) => layer.name)).toEqual(['Background', 'Grade', 'Paint']);

    const grouped = groupLayers(moved, [gradeId, paint.id], 'Look');
    const group = grouped.layers[1];
    expect(group.type).toBe('group');
    expect(group.type === 'group' ? group.children.map((layer) => layer.name) : [])
      .toEqual(['Grade', 'Paint']);
  });

  it('replaces a group or the complete image with the GPU destination raster', () => {
    const base = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'), 'Paint');
    const paint = base.layers[1];
    const withGroup = createGroupLayer(base, 'Retouch');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, paint.id, groupId);

    const flattenedGroup = flattenGroup(grouped, groupId);
    expect(flattenedGroup.layers.map((layer) => layer.name)).toEqual(['Background', 'Retouch']);
    expect(flattenedGroup.layers[1]).toMatchObject({
      id: paint.id,
      type: 'raster',
      transform: translationMatrix(0, 0),
      opacity: 1
    });

    const flattenedImage = flattenImage(grouped);
    expect(flattenedImage.layers).toHaveLength(1);
    expect(flattenedImage.layers[0]).toMatchObject({ type: 'raster', opacity: 1 });
  });

  it('tracks non-destructive geometry separately from source pixels', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const id = base.layers[0].id;
    const transformed = setLayerTransform(base, id, translationMatrix(12, -7));
    expect(transformed.layers[0].transform).toEqual(translationMatrix(12, -7));
    expect(transformed.layers[0].geometryRevision).toBe(1);
    expect(findRasterLayer(transformed, id)?.pixelRevision).toBe(0);
  });

  it('resets geometry after merging transformed layers into document pixels', () => {
    const base = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'));
    const topId = base.layers[1].id;
    const transformed = setLayerTransform(base, topId, translationMatrix(9, 4));
    const merged = mergeLayerDown(transformed, topId);
    expect(merged.layers[0].transform).toEqual(translationMatrix(0, 0));
  });

  it('clears baked Layer Style metadata after merge and flatten commands', () => {
    const base = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'), 'Styled');
    const styledId = base.layers[1].id;
    const styled = addLayerStyle(base, styledId, 'drop-shadow');
    expect(findRasterLayer(styled, styledId)?.styleStack.effects).toHaveLength(1);

    const merged = mergeLayerDown(styled, styledId);
    expect(merged.layers).toHaveLength(1);
    expect(findRasterLayer(merged, merged.layers[0].id)?.styleStack.effects).toEqual([]);

    const regrouped = groupLayers(styled, [styled.layers[0].id, styledId], 'Styled group');
    const group = regrouped.layers[0];
    if (group.type !== 'group') throw new Error('Expected group.');
    const flattened = flattenGroup(regrouped, group.id);
    expect(findRasterLayer(flattened, flattened.layers[0].id)?.styleStack.effects).toEqual([]);
  });

  it('applies Auto Align only to the unlocked target geometry', () => {
    const document = createRasterLayer(createImageDocument('Image', 100, 50, 'asset'));
    const reference = document.layers[0];
    const target = document.layers[1];
    const aligned = applyTranslationAlignment(document, {
      model: 'translation',
      referenceLayerId: reference.id,
      targetLayerId: target.id,
      correctionMatrix: translationMatrix(-4, 7),
      confidence: 0.9,
      overlap: 0.8,
      residualError: 0.01,
      diagnostics: {
        bestError: 0.01,
        secondBestError: 0.05,
        identityError: 0.1,
        improvementFromIdentity: 0.9,
        separation: 0.8,
        overlap: 0.8,
        validPixelCount: 100
      }
    });
    expect(aligned.layers[0].transform).toEqual(reference.transform);
    expect(aligned.layers[1].transform).toEqual(translationMatrix(-4, 7));
    expect(aligned.layers[1].geometryRevision).toBe(1);
  });
});
