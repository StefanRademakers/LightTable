import { describe, expect, it, vi } from 'vitest';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentOpenTransitionBindingOptions } from './DocumentOpenTransitionBinding';
import { DocumentOpenTransitionBinding } from './DocumentOpenTransitionBinding';

const fixture = (document: ImageDocument | null = null) => {
  const order: string[] = [];
  const mark = (name: string) => vi.fn(() => { order.push(name); });
  const options = {
    generation: {}, initialGlobalGradeStrength: 100, sourceName: 'source.png',
    processing: {
      prepareNewSource: mark('processing.prepare'),
      stageOpeningVisibility: mark('processing.visibility'),
      retireOpening: mark('processing.retire'),
      publishLoadedProcessing: mark('processing.publish'),
      presentExisting: mark('processing.present')
    },
    interactions: {
      prepareNewSource: mark('interactions.prepare'),
      initializeNewSelection: mark('selection.initialize'),
      initializeLensBlur: mark('lens.initialize'),
      sourcePublished: mark('interactions.published'),
      rebindExisting: mark('interactions.rebind')
    },
    loadedSource: {
      resetPresentation: mark('source.reset'),
      presentExisting: mark('source.present')
    },
    resetPresentation: {
      resetTelemetry: mark('presentation.telemetry'),
      resetDocument: mark('presentation.document'),
      publishAdjustments: mark('presentation.adjustments'),
      resetHistory: mark('presentation.history'),
      resetViewport: mark('presentation.viewport'),
      resetScopes: mark('presentation.scopes'),
      resetDiagnostics: mark('presentation.diagnostics')
    },
    publication: {
      commitPublication: (publish: () => void) => publish(),
      mergeStartupTimings: vi.fn(), publishDocument: vi.fn(), publishMetadata: vi.fn(),
      publishBinaryAssets: vi.fn(), publishPsdImport: vi.fn(), publishPsdCompatibility: vi.fn(),
      publishPsdDifference: vi.fn(), publishSource: vi.fn(), resetPublishedInteraction: mark('publication.reset'),
      publishStatus: vi.fn(), reportDifferenceFailure: vi.fn(), reportPsdWarnings: vi.fn()
    },
    resetFontsForOpen: mark('fonts.reset'),
    getExistingDocument: () => document,
    getPropertiesTarget: () => ({ kind: 'document' as const }),
    publishExistingDocument: mark('document.publish'),
    clearRebindStatus: mark('status.clear'),
    cancelAutoAlign: mark('auto-align.cancel')
  } as unknown as DocumentOpenTransitionBindingOptions;
  return { owner: new DocumentOpenTransitionBinding(options), order };
};

describe('DocumentOpenTransitionBinding', () => {
  it('prepares domain owners before resetting new-source presentation', () => {
    const { owner, order } = fixture();

    owner.beforeOpen();

    expect(order.slice(0, 3)).toEqual([
      'processing.prepare', 'interactions.prepare', 'fonts.reset'
    ]);
    expect(order).toContain('source.reset');
    expect(order).toContain('selection.initialize');
    expect(order).toContain('processing.visibility');
  });

  it('rebinds owner state before publishing an existing document and retires on close', () => {
    const document = { id: 'document-a' } as ImageDocument;
    const { owner, order } = fixture(document);

    owner.beforeExistingRebind();
    owner.afterClose();

    expect(order).toEqual([
      'interactions.rebind', 'status.clear', 'source.present', 'processing.present',
      'document.publish', 'processing.retire', 'auto-align.cancel'
    ]);
  });
});
