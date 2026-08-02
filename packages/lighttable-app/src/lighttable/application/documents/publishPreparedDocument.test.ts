import { describe, expect, it, vi } from 'vitest';
import type { PreparedDocumentSource } from './prepareDocumentSource';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import {
  publishPreparedDocument,
  type PreparedDocumentPublicationPorts
} from './publishPreparedDocument';

const ports = (): PreparedDocumentPublicationPorts => ({
  mergeStartupTimings: vi.fn(),
  publishDocument: vi.fn(),
  publishMetadata: vi.fn(),
  publishPsdImport: vi.fn(),
  publishPsdCompatibility: vi.fn(),
  publishPsdDifference: vi.fn(),
  publishSource: vi.fn(),
  resetDocumentInteraction: vi.fn(),
  publishAdjustments: vi.fn(),
  publishStatus: vi.fn(),
  reportDifferenceFailure: vi.fn(),
  reportPsdWarnings: vi.fn()
});

const prepared = (): PreparedDocumentSource => {
  const document = createImageDocument('Image', 2, 2, 'asset');
  const adjustments = createDefaultAdjustments();
  return {
    loaded: {
      document,
      metadata: {
        name: 'image.png',
        width: 2,
        height: 2,
        contentType: 'image/png'
      },
      imageBlob: new Blob(['pixels'], { type: 'image/png' }),
      layeredAdjustmentStack: null,
      psdImport: null,
      psdWarnings: [],
      psdCompatibility: [],
      fontAssets: [],
      preservedSourceAssets: [],
      timings: {
        layeredProbeMs: 1,
        decodeAndUploadMs: 4,
        documentInitMs: 1
      }
    },
    hydration: {
      adjustments,
      psdDifferenceMetrics: null,
      differenceError: null,
      status: null
    }
  };
};

describe('publishPreparedDocument', () => {
  it('publishes canonical state and matching source state in one sync call', () => {
    const target = ports();
    const source = prepared();

    publishPreparedDocument(source, {
      name: 'image.png',
      identity: 'source-1'
    }, target);

    expect(target.publishDocument).toHaveBeenCalledWith(source.loaded.document);
    expect(target.publishSource).toHaveBeenCalledWith(
      'image.png',
      source.loaded.imageBlob,
      'source-1'
    );
    expect(target.resetDocumentInteraction).toHaveBeenCalledOnce();
    expect(target.publishAdjustments).toHaveBeenCalledWith(
      source.hydration.adjustments
    );
    expect(target.publishStatus).not.toHaveBeenCalled();
  });
});
