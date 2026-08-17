import { describe, expect, it } from 'vitest';
import {
  cloneTextLayerData,
  createDefaultFlowTextSource,
  createDefaultTextLayerData
} from '@lighttable/text-core';
import {
  createTextLayer,
  renameLayer,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility
} from '../../editor/document/documentCommands';
import { createAdjustmentLayer, createImageDocument } from '../../editor/document/documentTypes';
import {
  documentCompositeRenderStatesEqual,
  documentRenderStatesEqual
} from './documentRenderState';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createDefaultAdjustments } from '../../types';

describe('document render state', () => {
  it('ignores insertion-only text metadata but observes paint revisions', () => {
    const document = createTextLayer(
      createImageDocument('Text state', 20, 20, 'source'),
      createDefaultTextLayerData(), 'Text'
    );
    const id = document.activeLayerId!;
    const layer = findDocumentLayer(document, id)!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') throw new Error('Expected flow text.');
    const populated = createDefaultFlowTextSource('x');
    const { start: _start, end: _end, ...insertionStyle } = populated.styleRuns[0];
    const insertionOnly = applyTextLayerDataMutation(document, id, {
      ...layer.text,
      source: { ...layer.text.source, insertionStyle: { ...insertionStyle, fontSize: 42 } }
    });
    expect(documentRenderStatesEqual(document, insertionOnly)).toBe(true);
    const current = findDocumentLayer(insertionOnly, id)!;
    if (current.type !== 'text' || current.text.source.kind !== 'flow') throw new Error('Expected flow text.');
    const painted = applyTextLayerDataMutation(insertionOnly, id, {
      ...current.text,
      source: { ...current.text.source, styleRuns: current.text.source.styleRuns.map((run) => ({
        ...run,
        fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } }
      })) }
    });
    expect(documentRenderStatesEqual(insertionOnly, painted)).toBe(false);
  });
  it('accepts repeated publications of the same immutable document', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    expect(documentRenderStatesEqual(document, document)).toBe(true);
  });

  it('never reuses render state across documents', () => {
    const current = createImageDocument('Image', 64, 32, 'asset');
    const next = createImageDocument('Image', 64, 32, 'asset');
    expect(documentRenderStatesEqual(current, next)).toBe(false);
  });

  it('ignores layer names and editor locks', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const layerId = document.layers[0].id;
    const renamed = renameLayer(document, layerId, 'Plate');
    const locked = setLayerLocked(renamed, layerId, true);

    expect(renamed.revision).toBeGreaterThan(document.revision);
    expect(locked.revision).toBeGreaterThan(renamed.revision);
    expect(documentRenderStatesEqual(document, renamed)).toBe(true);
    expect(documentRenderStatesEqual(renamed, locked)).toBe(true);
  });

  it('detects compositing changes', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const layerId = document.layers[0].id;

    expect(documentRenderStatesEqual(
      document,
      setLayerOpacity(document, layerId, 0.5)
    )).toBe(false);
    expect(documentRenderStatesEqual(
      document,
      setLayerVisibility(document, layerId, false)
    )).toBe(false);
  });

  it('invalidates the layer composite when a Lens FX processing layer changes', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const first = createDefaultAdjustments();
    first.effects.lensDistortion.enabled = true;
    first.effects.lensDistortion.amount = 20;
    const lensFx = createAdjustmentLayer(
      selectAdjustmentLayerModules(createAdjustmentStackFromBasicAdjustments(first), 'lens-fx'),
      'Lens Fx',
      'lens-fx'
    );
    document.layers.push(lensFx);
    const second = createDefaultAdjustments();
    second.effects.lensDistortion.enabled = true;
    second.effects.lensDistortion.amount = 80;
    const changed = {
      ...document,
      layers: [
        document.layers[0],
        {
          ...lensFx,
          adjustmentStack: selectAdjustmentLayerModules(
            createAdjustmentStackFromBasicAdjustments(second, lensFx.adjustmentStack),
            'lens-fx'
          )
        }
      ]
    };

    expect(documentRenderStatesEqual(document, changed)).toBe(false);
    expect(documentCompositeRenderStatesEqual(document, changed)).toBe(false);
    expect(documentCompositeRenderStatesEqual(document, {
      ...changed,
      layers: [changed.layers[0], { ...changed.layers[1], opacity: 0.5 }]
    })).toBe(false);
  });

  it('detects raster pixel changes without depending on generic revisions', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const raster = document.layers[0];
    if (raster.type !== 'raster') throw new Error('Expected raster fixture.');
    const changed = {
      ...document,
      revision: document.revision + 1,
      layers: [{ ...raster, pixelRevision: raster.pixelRevision + 1 }]
    };

    expect(documentRenderStatesEqual(document, changed)).toBe(false);
  });

  it('detects render-bearing preview changes that retain the canonical revision', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const raster = document.layers[0];
    if (raster.type !== 'raster') throw new Error('Expected raster fixture.');
    const preview = {
      ...document,
      layers: [{
        ...raster,
        adjustmentStack: {
          id: 'preview-adjustments',
          revision: 1,
          modules: []
        }
      }]
    };

    expect(preview.revision).toBe(document.revision);
    expect(documentRenderStatesEqual(document, preview)).toBe(false);
  });

  it('detects canonical text payload changes', () => {
    const document = createTextLayer(
      createImageDocument('Text fixture', 64, 32, 'asset'),
      createDefaultTextLayerData()
    );
    const text = document.layers.at(-1);
    if (text?.type !== 'text') throw new Error('Expected text fixture.');
    const clonedText = cloneTextLayerData(text.text);
    const changedText = {
      ...clonedText,
      revisions: {
        ...clonedText.revisions,
        content: clonedText.revisions.content + 1
      }
    };
    const changed = {
      ...document,
      layers: [...document.layers.slice(0, -1), { ...text, text: changedText }]
    };

    expect(documentRenderStatesEqual(document, changed)).toBe(false);
  });
});
