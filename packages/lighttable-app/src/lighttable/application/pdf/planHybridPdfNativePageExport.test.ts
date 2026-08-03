import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { describe, expect, it } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { planHybridPdfNativePageExport } from './planHybridPdfNativePageExport';

const path = () => createVectorPath('shape', 'Shape', [createSubpath('outline', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 10, y: 0 }),
  createAnchor('c', { x: 10, y: 10 })
], true)]);

const textPlan = (layerId: string): PdfTextExportPlan => ({
  fonts: [], canExport: true, requiresConfirmation: false,
  summary: { subset: 0, 'embed-existing': 0, 'embed-full': 0, outline: 0, raster: 0, blocked: 0 },
  layers: [{
    layerId, name: 'Text', sourceKind: 'flow', disposition: 'text', searchable: true,
    requiresConfirmation: false, reasons: [], runs: []
  }]
});

describe('planHybridPdfNativePageExport', () => {
  it('preserves an interleaved native text/vector suffix in document order', () => {
    const document = createImageDocument('Mixed', 100, 100, 'pixels');
    const bottomVector = createVectorLayer([path()]);
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const topVector = createVectorLayer([path()]);
    document.layers.push(bottomVector, text, topVector);

    const result = planHybridPdfNativePageExport({
      document, textPlan: textPlan(text.id), documentProcessingActive: false
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect([...result.nativeTextLayerIds]).toEqual([text.id]);
    expect([...result.nativeVectorLayerIds]).toEqual([bottomVector.id, topVector.id]);
    expect(result.nativeLayerOrder).toEqual([bottomVector.id, text.id, topVector.id]);
  });

  it('fails closed when non-native content interrupts the top suffix', () => {
    const base = createImageDocument('Interrupted', 100, 100, 'pixels');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    base.layers.push(text);
    base.activeLayerId = text.id;
    const document = createRasterLayer(base, 'Foreground');
    expect(planHybridPdfNativePageExport({
      document, textPlan: textPlan(text.id), documentProcessingActive: false
    })).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['native-content-not-topmost'])
    });
  });

  it('blocks native suffix export while document-wide processing is active', () => {
    const document = createImageDocument('Processed', 100, 100, 'pixels');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers.push(text);
    expect(planHybridPdfNativePageExport({
      document, textPlan: textPlan(text.id), documentProcessingActive: true
    })).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['document-processing-active'])
    });
  });
});
