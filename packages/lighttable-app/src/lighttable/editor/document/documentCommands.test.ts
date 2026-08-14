import { describe, expect, it } from 'vitest';
import { createImageDocument, type ImageDocument, type LayerId } from './documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  addLayerMask,
  applyTranslationAlignment,
  createAdjustmentLayer,
  createGradientFillLayer,
  createGroupLayer,
  createRasterLayer,
  createTextLayer,
  createVectorLayer,
  convertVectorLiveShapeToPath,
  appendVectorElement,
  replaceVectorLayerElements,
  appendVectorPath,
  replaceVectorPath,
  replaceTextLayerWithVectorPaths,
  deleteVectorPaths,
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
  setLayerMaskLinked,
  setLayerMaskTransform,
  setLayerOpacity,
  setLayerTransform,
  setLayerVisibility,
  setLayersLock,
  setLayersVisibility,
  setVectorLayerAntiAlias,
  ungroupLayers
} from './documentCommands';
import { createPlacedRasterLayer } from './placedRasterLayerCommand';
import {
  createAnchor,
  createSubpath,
  createVectorLiveShape,
  createVectorPath
} from '@lighttable/vector-core';
import { translationMatrix } from '../tools/transform/affine';
import {
  findDocumentLayer,
  findRasterLayer,
  rasterLayersForComposite,
  siblingLayers
} from './layerTree';
import { addLayerStyle } from '../styles/layerStyleCommands';
import { createDefaultTextLayerData } from '@lighttable/text-core';

describe('LightTable document commands', () => {
  it('creates a tight placed raster with document-space placement', () => {
    const source = createImageDocument('Placement', 320, 180, 'asset');
    const result = createPlacedRasterLayer(source, {
      name: 'Logo', width: 64, height: 48, x: -12, y: 73
    });
    const layer = findRasterLayer(result, result.activeLayerId!);
    expect(layer).toMatchObject({
      name: 'Logo', width: 64, height: 48,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: -12, ty: 73 }
    });
    expect(source.layers).toHaveLength(1);
    const duplicate = createPlacedRasterLayer(result, {
      name: 'Logo', width: 64, height: 48, x: 0, y: 0
    });
    expect(findRasterLayer(duplicate, duplicate.activeLayerId!)?.name).toBe('Logo 2');
  });

  it('creates a full-canvas semantic Gradient Fill above the active layer', () => {
    const source = createImageDocument('Gradient', 320, 180, 'asset');
    const result = createGradientFillLayer(source);
    const layer = result.layers.find(({ id }) => id === result.activeLayerId);
    expect(layer).toMatchObject({ type: 'vector', role: 'gradient-fill', name: 'Gradient Fill' });
    if (layer?.type !== 'vector') throw new Error('Expected Gradient Fill vector layer.');
    expect(layer.elements[0]).toMatchObject({
      type: 'live-shape', geometry: { kind: 'rectangle', width: 320, height: 180 },
      style: { fill: { kind: 'gradient', coordinateSpace: 'object-bounds' }, stroke: null }
    });
  });

  it('replaces text with cloned paths without mutating the editable source snapshot', () => {
    const opening = createTextLayer(
      createImageDocument('Convert text', 200, 100, 'asset'),
      createDefaultTextLayerData(),
      'Editable title'
    );
    const layerId = opening.activeLayerId!;
    const transformed = setLayerTransform(opening, layerId, {
      a: 2, b: 0.25, c: 0, d: 2, tx: 30, ty: 12
    });
    const sourceText = findDocumentLayer(transformed, layerId);
    if (sourceText?.type !== 'text') throw new Error('Expected text layer fixture.');
    const path = createVectorPath('glyph-a', 'A', [createSubpath('contour', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 10, y: 20 }),
      createAnchor('c', { x: 20, y: 0 })
    ], true)]);

    const converted = replaceTextLayerWithVectorPaths(transformed, layerId, [path]);
    const vector = findDocumentLayer(converted, layerId);

    expect(vector?.type).toBe('vector');
    if (vector?.type !== 'vector') throw new Error('Expected converted vector layer.');
    expect(vector.id).toBe(sourceText.id);
    expect(vector.name).toBe(sourceText.name);
    expect(vector.transform).toEqual(sourceText.transform);
    expect(vector.styleStack).toBe(sourceText.styleStack);
    expect(vector.mask).toBe(sourceText.mask);
    expect(vector.elements).toHaveLength(1);
    expect(vector.elements[0]).toEqual(path);
    expect(vector.elements[0]).not.toBe(path);
    expect(converted.activeLayerId).toBe(layerId);
    expect(findDocumentLayer(transformed, layerId)).toBe(sourceText);
    expect(sourceText.text.source.kind).toBe('flow');
  });

  it('refuses text conversion for locked and empty path sources', () => {
    const withText = createTextLayer(
      createImageDocument('Locked text', 100, 50, 'asset'),
      createDefaultTextLayerData()
    );
    const layerId = withText.activeLayerId!;
    expect(replaceTextLayerWithVectorPaths(withText, layerId, [])).toBe(withText);
    const locked = setLayerLock(withText, layerId, 'pixels', true);
    expect(replaceTextLayerWithVectorPaths(locked, layerId, [createVectorPath('glyph')])).toBe(locked);
  });

  it('owns native vector paths through immutable document commands', () => {
    const source = createImageDocument('Vectors', 100, 50, 'asset');
    const first = createVectorPath('triangle', 'Triangle', [
      createSubpath('triangle-outline', [
        createAnchor('a', { x: 5, y: 5 }),
        createAnchor('b', { x: 25, y: 5 }),
        createAnchor('c', { x: 15, y: 25 })
      ], true)
    ]);
    const withVector = createVectorLayer(source, [first], 'Shapes');
    const vectorId = withVector.activeLayerId!;
    const vector = findDocumentLayer(withVector, vectorId);

    expect(vector?.type).toBe('vector');
    if (vector?.type !== 'vector') throw new Error('Expected a vector layer.');
    expect(vector.elements[0]).not.toBe(first);

    const second = createVectorPath('second', 'Second');
    const appended = appendVectorPath(withVector, vectorId, second);
    const replacement = { ...second, name: 'Renamed', styleRevision: 1 };
    const replaced = replaceVectorPath(appended, vectorId, replacement);
    const deleted = deleteVectorPaths(replaced, vectorId, [first.id]);
    const result = findDocumentLayer(deleted, vectorId);

    expect(result?.type).toBe('vector');
    if (result?.type !== 'vector') throw new Error('Expected a vector layer.');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.name).toBe('Renamed');
    expect(result.elements[0]).not.toBe(replacement);
    expect(deleted.revision).toBe(withVector.revision + 3);
  });

  it('rejects duplicate vector path ids without changing the document', () => {
    const source = createImageDocument('Vectors', 100, 50, 'asset');
    const path = createVectorPath('path', 'Path');
    const withVector = createVectorLayer(source, [path]);

    expect(() => appendVectorPath(withVector, withVector.activeLayerId!, path))
      .toThrow(/already exists/);
  });

  it('preserves parametrically editable live shapes beside paths', () => {
    const source = createImageDocument('Mixed vectors', 100, 50, 'asset');
    const path = createVectorPath('path', 'Path');
    const ellipse = createVectorLiveShape('ellipse', {
      kind: 'ellipse',
      width: 32,
      height: 18
    }, 'Editable ellipse');
    const withVector = createVectorLayer(source, [ellipse, path]);
    const vectorId = withVector.activeLayerId!;
    const replacement = createVectorLiveShape('rectangle', {
      kind: 'rectangle',
      width: 48,
      height: 24,
      cornerRadii: [4, 8, 4, 8],
      linkedCorners: false
    }, 'Editable rectangle');
    const updated = replaceVectorLayerElements(withVector, vectorId, [replacement, path]);
    const appended = appendVectorElement(updated, vectorId, ellipse);
    const layer = findDocumentLayer(appended, vectorId);

    expect(layer?.type === 'vector' ? layer.elements : null).toEqual([replacement, path, ellipse]);
    expect(layer?.type === 'vector' ? layer.elements[0] : null).not.toBe(replacement);
    expect(() => replaceVectorPath(updated, vectorId, createVectorPath(replacement.id, 'Wrong type')))
      .toThrow(/live shape/);
  });

  it('rejects duplicate ids across paths and live shapes', () => {
    const source = createImageDocument('Mixed vectors', 100, 50, 'asset');
    const path = createVectorPath('shared-id', 'Path');
    const ellipse = createVectorLiveShape('shared-id', {
      kind: 'ellipse',
      width: 20,
      height: 20
    });

    expect(() => createVectorLayer(source, [path, ellipse])).toThrow(/Duplicate vector element id/);
  });

  it('converts live shapes to editable paths as one explicit document command', () => {
    const source = createImageDocument('Convert shape', 100, 50, 'asset');
    const shape = createVectorLiveShape('shape', {
      kind: 'rectangle',
      width: 40,
      height: 20,
      cornerRadii: [3, 3, 3, 3],
      linkedCorners: true
    }, 'Rounded rectangle');
    shape.geometryRevision = 6;
    const withVector = createVectorLayer(source, [shape]);
    const vectorId = withVector.activeLayerId!;

    const converted = convertVectorLiveShapeToPath(withVector, vectorId, shape.id);
    const layer = findDocumentLayer(converted, vectorId);
    const element = layer?.type === 'vector' ? layer.elements[0] : null;

    expect(element).toMatchObject({
      id: shape.id,
      type: 'path',
      name: shape.name,
      geometryRevision: 7
    });
    expect(element?.type === 'path' ? element.subpaths : []).not.toHaveLength(0);
    expect(converted.revision).toBe(withVector.revision + 1);
    expect(() => convertVectorLiveShapeToPath(converted, vectorId, shape.id))
      .toThrow(/already a path/);
  });

  it('toggles vector antialiasing without changing vector geometry', () => {
    const source = createImageDocument('Vector AA', 100, 50, 'asset');
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse',
      width: 40,
      height: 20
    });
    const withVector = createVectorLayer(source, [shape]);
    const vectorId = withVector.activeLayerId!;

    const updated = setVectorLayerAntiAlias(withVector, vectorId, false);
    const layer = findDocumentLayer(updated, vectorId);

    expect(layer?.type === 'vector' ? layer.antiAlias : null).toBe(false);
    expect(layer?.type === 'vector' ? layer.elements : null).toEqual([shape]);
    expect(updated.revision).toBe(withVector.revision + 1);
  });

  it('updates mask density and feather as one canonical mask revision', () => {
    const source = createImageDocument('Masked', 100, 50, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const updated = setLayerMaskProperties(masked, layerId, { density: 0.35, feather: 12.5 });
    const mask = findDocumentLayer(updated, layerId)?.mask;

    expect(mask).toMatchObject({ density: 0.35, feather: 12.5, revision: 1 });
  });

  it('moves a linked mask by the same document-space delta as its layer', () => {
    const source = createImageDocument('Linked mask', 100, 50, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const moved = setLayerTransform(masked, layerId, translationMatrix(12, -7));
    const layer = findDocumentLayer(moved, layerId);

    expect(layer?.transform).toEqual(translationMatrix(12, -7));
    expect(layer?.mask).toMatchObject({
      linked: true,
      transform: translationMatrix(12, -7),
      revision: 1
    });
  });

  it('leaves an unlinked mask stationary when its layer moves', () => {
    const source = createImageDocument('Unlinked mask', 100, 50, 'asset');
    const layerId = source.activeLayerId!;
    const masked = setLayerMaskLinked(addLayerMask(source, layerId), layerId, false);
    const moved = setLayerTransform(masked, layerId, translationMatrix(12, -7));
    const layer = findDocumentLayer(moved, layerId);

    expect(layer?.transform).toEqual(translationMatrix(12, -7));
    expect(layer?.mask?.linked).toBe(false);
    expect(layer?.mask?.transform).toEqual(translationMatrix(0, 0));
  });

  it('transforms an unlinked mask without changing layer geometry', () => {
    const source = createImageDocument('Mask only', 100, 50, 'asset');
    const layerId = source.activeLayerId!;
    const masked = setLayerMaskLinked(addLayerMask(source, layerId), layerId, false);
    const moved = setLayerMaskTransform(masked, layerId, translationMatrix(-4, 9));
    const layer = findDocumentLayer(moved, layerId);

    expect(layer?.transform).toEqual(translationMatrix(0, 0));
    expect(layer?.mask).toMatchObject({
      linked: false,
      transform: translationMatrix(-4, 9),
      revision: 2
    });
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

  it('projects a merged vector-over-raster pair to the raster destination', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withVector = createVectorLayer(base, [], 'Shape');
    const merged = mergeLayerDown(withVector, withVector.activeLayerId!);

    expect(merged.layers).toHaveLength(1);
    expect(merged.layers[0]?.id).not.toBe(base.layers[0]!.id);
    expect(merged.layers[0]).toMatchObject({
      type: 'raster', name: 'Shape', opacity: 1,
      fillOpacity: 1, blendMode: 'normal', transform: translationMatrix(0, 0)
    });
  });

  it('rasterizes a bottom vector shape when merging it with a raster layer above', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const withVector = createVectorLayer(base, [], 'Shape');
    const withRaster = createRasterLayer(withVector, 'Pixels');
    const [background, shape, pixels] = withRaster.layers;
    const merged = mergeLayers(withRaster, [shape.id, pixels.id]);

    expect(merged.layers).toHaveLength(2);
    expect(merged.layers[0]?.id).toBe(background.id);
    expect(merged.layers[1]).toMatchObject({
      type: 'raster', name: 'Pixels', width: 100, height: 50,
      offsetX: 0, offsetY: 0, transform: translationMatrix(0, 0)
    });
    expect(merged.layers[1]?.id).not.toBe(shape.id);
    expect(getMergeLayersPlan(withRaster, [pixels.id, shape.id])).toEqual({
      destinationId: shape.id,
      layerIds: [shape.id, pixels.id],
      name: pixels.name
    });
  });

  it('merges a contiguous raster selection and rejects appearance-changing selections', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const middle = createRasterLayer(base, 'Middle');
    const document = createRasterLayer(middle, 'Top');
    const [background, middleLayer, top] = document.layers;

    const merged = mergeLayers(document, [top.id, middleLayer.id]);
    expect(merged.layers[0]?.id).toBe(background.id);
    expect(merged.layers[1]?.id).not.toBe(middleLayer.id);
    expect(merged.layers[1]).toMatchObject({
      name: 'Top',
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      mask: null
    });
    expect(merged.activeLayerId).toBe(merged.layers[1]?.id);

    expect(mergeLayers(document, [background.id, top.id])).toBe(document);
    const grouped = createGroupLayer(document, 'Group');
    const mergedWithGroup = mergeLayers(grouped, [top.id, grouped.activeLayerId!]);
    expect(mergedWithGroup).not.toBe(grouped);
    expect(mergedWithGroup.layers.at(-1)).toMatchObject({ type: 'raster', name: 'Group' });
  });

  it('merges every ordered pair and three-layer combination through one semantic contract', () => {
    type Kind = 'raster' | 'shape' | 'gradient' | 'adjustment' | 'text' | 'group';
    const kinds: readonly Kind[] = [
      'raster', 'shape', 'gradient', 'adjustment', 'text', 'group'
    ];
    const append = (source: ImageDocument, kind: Kind, name: string): ImageDocument => {
      if (kind === 'raster') return createRasterLayer(source, name);
      if (kind === 'shape') return createVectorLayer(source, [
        createVectorLiveShape(`shape-${crypto.randomUUID()}`, {
          kind: 'rectangle', width: 12, height: 9,
          cornerRadii: [0, 0, 0, 0], linkedCorners: true
        }, name)
      ], name);
      if (kind === 'gradient') return createGradientFillLayer(source, undefined, name);
      if (kind === 'adjustment') return createAdjustmentLayer(
        source,
        createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
        name
      );
      if (kind === 'text') return createTextLayer(source, createDefaultTextLayerData(), name);
      const withChild = createRasterLayer(source, `${name} content`);
      return groupLayers(withChild, [withChild.activeLayerId!], name);
    };
    const selectedRootIds = (document: ImageDocument, count: number): LayerId[] =>
      document.layers.slice(-count).map(({ id }) => id);

    for (const bottomKind of kinds) {
      for (const topKind of kinds) {
        let pair = createImageDocument('Pair', 48, 32, 'background');
        pair = append(pair, bottomKind, `Bottom ${bottomKind}`);
        pair = append(pair, topKind, `Top ${topKind}`);
        const [bottomId, topId] = selectedRootIds(pair, 2);
        const plan = getMergeLayersPlan(pair, [topId, bottomId]);
        expect(plan, `${bottomKind} below ${topKind}`).toMatchObject({
          layerIds: [bottomId, topId], destinationId: bottomId, name: `Top ${topKind}`
        });
        const merged = mergeLayers(pair, [topId, bottomId]);
        expect(merged.layers, `${bottomKind} below ${topKind}`).toHaveLength(2);
        expect(merged.layers.at(-1), `${bottomKind} below ${topKind}`).toMatchObject({
          type: 'raster', name: `Top ${topKind}`, width: 48, height: 32
        });
        expect(mergeLayerDown(pair, topId), `${bottomKind} below ${topKind}`).not.toBe(pair);

        for (const thirdKind of kinds) {
          const triple = append(pair, thirdKind, `Topmost ${thirdKind}`);
          const ids = selectedRootIds(triple, 3);
          const triplePlan = getMergeLayersPlan(triple, [...ids].reverse());
          expect(triplePlan, `${bottomKind}/${topKind}/${thirdKind}`).toMatchObject({
            layerIds: ids, destinationId: ids[0], name: `Topmost ${thirdKind}`
          });
          const tripleMerged = mergeLayers(triple, [...ids].reverse());
          expect(tripleMerged.layers, `${bottomKind}/${topKind}/${thirdKind}`).toHaveLength(2);
          expect(tripleMerged.layers.at(-1)?.type).toBe('raster');
          const flattened = flattenImage(triple);
          expect(flattened.layers, `${bottomKind}/${topKind}/${thirdKind} flatten`).toHaveLength(1);
          expect(flattened.layers[0]).toMatchObject({
            type: 'raster', width: 48, height: 32, opacity: 1, blendMode: 'normal'
          });
        }
      }
    }
  });

  it('merges and flattens every ordered layer pair inside the same group', () => {
    type Kind = 'raster' | 'shape' | 'gradient' | 'adjustment' | 'text';
    const kinds: readonly Kind[] = ['raster', 'shape', 'gradient', 'adjustment', 'text'];
    const append = (source: ImageDocument, kind: Kind, name: string) => {
      if (kind === 'raster') return createRasterLayer(source, name);
      if (kind === 'shape') return createVectorLayer(source, [
        createVectorLiveShape(`nested-${crypto.randomUUID()}`, {
          kind: 'ellipse', width: 10, height: 8
        }, name)
      ], name);
      if (kind === 'gradient') return createGradientFillLayer(source, undefined, name);
      if (kind === 'adjustment') return createAdjustmentLayer(
        source,
        createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
        name
      );
      return createTextLayer(source, createDefaultTextLayerData(), name);
    };

    for (const bottomKind of kinds) {
      for (const topKind of kinds) {
        let document = createImageDocument('Nested', 40, 30, 'background');
        document = append(document, bottomKind, `Bottom ${bottomKind}`);
        const bottomId = document.activeLayerId!;
        document = append(document, topKind, `Top ${topKind}`);
        const topId = document.activeLayerId!;
        document = groupLayers(document, [bottomId, topId], 'Pair');
        const groupId = document.activeLayerId!;
        const plan = getMergeLayersPlan(document, [topId, bottomId]);
        expect(plan, `${bottomKind} below ${topKind} in group`).toMatchObject({
          layerIds: [bottomId, topId], destinationId: bottomId
        });
        const merged = mergeLayers(document, [topId, bottomId]);
        const mergedGroup = findDocumentLayer(merged, groupId);
        expect(mergedGroup?.type).toBe('group');
        if (mergedGroup?.type !== 'group') throw new Error('Expected the pair group.');
        expect(mergedGroup.children).toHaveLength(1);
        expect(mergedGroup.children[0]?.type).toBe('raster');

        const flattened = flattenGroup(document, groupId);
        expect(findDocumentLayer(flattened, flattened.activeLayerId)?.type).toBe('raster');
        expect(findDocumentLayer(flattened, groupId)).toBeNull();
      }
    }
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
    expect(flattenedGroup.layers[1]?.id).not.toBe(paint.id);
    expect(flattenedGroup.layers[1]).toMatchObject({
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
