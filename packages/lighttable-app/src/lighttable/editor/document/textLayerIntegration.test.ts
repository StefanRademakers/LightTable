import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import {
  addLayerMask,
  createGroupLayer,
  createTextLayer,
  deleteLayer,
  duplicateLayer,
  flattenGroup,
  flattenImage,
  mergeLayerDown,
  moveLayerIntoGroup,
  moveLayerRelative,
  replaceVectorLayerElements,
  rasterizeTextLayer,
  setLayerBlendMode,
  setLayerFillOpacity,
  setLayerOpacity,
  setLayerTransform,
  ungroupLayers
} from './documentCommands';
import { createImageDocument } from './documentTypes';
import { findDocumentLayer } from './layerTree';
import { buildSceneTransformIndex, requireSceneTransform } from './sceneTransformGraph';
import { translationMatrix } from '../geometry/affine';

describe('canonical text layer integration', () => {
  it('creates and duplicates an independent canonical payload with common semantics', () => {
    const payload = createDefaultTextLayerData();
    const document = createTextLayer(
      createImageDocument('Text fixture', 128, 96, 'background'),
      payload,
      'Headline'
    );
    const textId = document.activeLayerId!;
    const text = findDocumentLayer(document, textId);

    expect(text).toMatchObject({
      type: 'text',
      name: 'Headline',
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      mask: null
    });
    expect(text?.type === 'text' ? text.text : null).toEqual(payload);
    expect(text?.type === 'text' ? text.text : null).not.toBe(payload);

    const styled = addLayerMask(
      setLayerBlendMode(setLayerFillOpacity(setLayerOpacity(document, textId, 0.8), textId, 0.6), textId, 'multiply'),
      textId
    );
    const duplicated = duplicateLayer(styled, textId);
    const clone = findDocumentLayer(duplicated, duplicated.activeLayerId);
    const original = findDocumentLayer(styled, textId);

    expect(clone?.id).not.toBe(textId);
    expect(clone).toMatchObject({ type: 'text', opacity: 0.8, fillOpacity: 0.6, blendMode: 'multiply' });
    expect(clone?.type === 'text' ? clone.text : null).toEqual(payload);
    expect(clone?.type === 'text' ? clone.text : null)
      .not.toBe(original?.type === 'text' ? original.text : null);
    expect(clone?.mask?.id).not.toBe(original?.mask?.id);
  });

  it('preserves a text layer world transform while reparenting and ungrouping', () => {
    const source = createTextLayer(
      createImageDocument('Transforms', 128, 96, 'background'),
      createDefaultTextLayerData()
    );
    const textId = source.activeLayerId!;
    const movedText = setLayerTransform(source, textId, translationMatrix(31, 17));
    const withGroup = createGroupLayer(movedText, 'Translated group');
    const groupId = withGroup.activeLayerId!;
    const transformedGroup = setLayerTransform(withGroup, groupId, translationMatrix(9, -4));
    const before = requireSceneTransform(buildSceneTransformIndex(transformedGroup), textId).localToDocument;

    const grouped = moveLayerIntoGroup(transformedGroup, textId, groupId);
    const whileGrouped = requireSceneTransform(buildSceneTransformIndex(grouped), textId).localToDocument;
    const ungrouped = ungroupLayers(grouped, [groupId]);
    const after = requireSceneTransform(buildSceneTransformIndex(ungrouped), textId).localToDocument;

    expect(whileGrouped).toEqual(before);
    expect(after).toEqual(before);
    expect(findDocumentLayer(ungrouped, textId)?.id).toBe(textId);
  });

  it('keeps raster/vector-only commands from destructively consuming text', () => {
    const document = createTextLayer(
      createImageDocument('Protected text', 128, 96, 'background'),
      createDefaultTextLayerData()
    );
    const textId = document.activeLayerId!;
    const withGroup = createGroupLayer(document, 'Group');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, textId, groupId);

    expect(mergeLayerDown(document, textId)).toBe(document);
    expect(flattenImage(document)).toBe(document);
    expect(flattenGroup(grouped, groupId)).toBe(grouped);
    expect(replaceVectorLayerElements(document, textId, [])).toBe(document);

    const deleted = deleteLayer(document, textId);
    expect(findDocumentLayer(deleted, textId)).toBeNull();
    expect(deleted.layers).toHaveLength(1);
  });

  it('keeps rejected group-to-descendant moves as exact structural and transform no-ops', () => {
    const withOuter = createGroupLayer(
      createImageDocument('Invalid move', 128, 96, 'background'),
      'Outer'
    );
    const outerId = withOuter.activeLayerId!;
    const withNested = createGroupLayer(withOuter, 'Nested');
    const nestedId = withNested.activeLayerId!;
    const nested = moveLayerIntoGroup(withNested, nestedId, outerId);
    const transformed = setLayerTransform(
      setLayerTransform(nested, outerId, translationMatrix(13, 7)),
      nestedId,
      translationMatrix(-2, 5)
    );
    const beforeOuter = requireSceneTransform(buildSceneTransformIndex(transformed), outerId).localToDocument;
    const beforeNested = requireSceneTransform(buildSceneTransformIndex(transformed), nestedId).localToDocument;

    const insideDescendant = moveLayerIntoGroup(transformed, outerId, nestedId);
    const relativeToDescendant = moveLayerRelative(transformed, outerId, nestedId, 'above');

    expect(insideDescendant).toBe(transformed);
    expect(relativeToDescendant).toBe(transformed);
    expect(requireSceneTransform(buildSceneTransformIndex(transformed), outerId).localToDocument)
      .toEqual(beforeOuter);
    expect(requireSceneTransform(buildSceneTransformIndex(transformed), nestedId).localToDocument)
      .toEqual(beforeNested);
  });

  it('creates a same-ID neutral-geometry raster destination while retaining layer semantics', () => {
    const document = createTextLayer(
      createImageDocument('Rasterize', 128, 96, 'background'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const id = document.activeLayerId!;
    const prepared = addLayerMask(setLayerTransform(
      setLayerBlendMode(setLayerOpacity(document, id, 0.75), id, 'multiply'),
      id,
      translationMatrix(12, 8)
    ), id);
    const rasterized = rasterizeTextLayer(prepared, id);
    const raster = findDocumentLayer(rasterized, id);

    expect(raster).toMatchObject({
      id,
      type: 'raster',
      opacity: 0.75,
      blendMode: 'multiply',
      transform: translationMatrix(0, 0),
      width: 128,
      height: 96,
      pixelRevision: 1
    });
    expect(raster?.mask?.id).toBe(findDocumentLayer(prepared, id)?.mask?.id);
    expect(rasterized.activeLayerId).toBe(id);
    expect(flattenImage(rasterized)).not.toBe(rasterized);
    expect(mergeLayerDown(rasterized, id)).not.toBe(rasterized);
  });
});
