import { describe, expect, it } from 'vitest';
import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createRasterLayer, createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import {
  pdfDocumentProcessingActive,
  planHybridPdfPageExport
} from './planHybridPdfPageExport';

const withText = (): ImageDocument => createTextLayer(
  createImageDocument('Hybrid PDF', 320, 200, 'asset'),
  createDefaultTextLayerData(),
  'Native text'
);

const textPlan = (document: ImageDocument, canExport = true): PdfTextExportPlan => ({
  fonts: [], canExport, requiresConfirmation: false,
  summary: { subset: 0, 'embed-existing': 0, 'embed-full': 0, outline: 0, raster: 0, blocked: 0 },
  layers: [{
    layerId: document.layers.find(layer => layer.type === 'text')!.id,
    name: 'Native text', sourceKind: 'flow', disposition: 'text', searchable: true,
    requiresConfirmation: false, reasons: [], runs: []
  }]
});

describe('hybrid PDF page export planning', () => {
  it('detects document processing without treating defaults as active', () => {
    const defaults = createDefaultAdjustments();
    expect(pdfDocumentProcessingActive(defaults)).toBe(false);
    expect(pdfDocumentProcessingActive({ ...defaults, contrast: 15 })).toBe(true);
  });

  it('allows a native text suffix over a raster underlay', () => {
    const document = withText();
    const result = planHybridPdfPageExport({
      document, textPlan: textPlan(document), documentProcessingActive: false
    });
    expect(result.kind).toBe('ready');
  });

  it('fails closed when raster content is above native text', () => {
    const text = withText();
    const document = createRasterLayer(text, 'Foreground');
    expect(planHybridPdfPageExport({
      document, textPlan: textPlan(document), documentProcessingActive: false
    })).toEqual({ kind: 'flattened-only', reasons: ['native-text-not-topmost'] });
  });

  it('keeps document-wide processing on the flattened path', () => {
    const document = withText();
    expect(planHybridPdfPageExport({
      document, textPlan: textPlan(document), documentProcessingActive: true
    })).toEqual({ kind: 'flattened-only', reasons: ['document-processing-active'] });
  });
});
