import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import {
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { LoadedDocumentSource } from './loadDocumentSource';
import { hydrateDocumentSource } from './hydrateDocumentSource';

const loadedSource = (
  overrides: Partial<LoadedDocumentSource> = {}
): LoadedDocumentSource => ({
  document: createImageDocument('image.png', 10, 10, 'asset'),
  metadata: {
    name: 'image.png',
    width: 10,
    height: 10,
    contentType: 'image/png'
  },
  imageBlob: new Blob(),
  layeredAdjustmentStack: null,
  psdImport: null,
  psdWarnings: [],
  psdCompatibility: [],
  fontAssets: [],
  preservedSourceAssets: [],
  timings: {
    layeredProbeMs: 1,
    sourceDecodeMs: 0,
    decodeAndUploadMs: 2,
    documentInitMs: 3
  },
  ...overrides
});

const renderer = () => ({
  setAdjustmentStack: vi.fn(),
  setAdjustments: vi.fn(),
  measureReferenceDifference: vi.fn()
});

describe('hydrateDocumentSource', () => {
  it('applies the initial document grade when no layered stack exists', async () => {
    const target = renderer();
    const adjustments: BasicAdjustments = {
      ...createDefaultAdjustments(),
      exposureEV: 1.25
    };

    const result = await hydrateDocumentSource({
      renderer: target,
      loaded: loadedSource(),
      initialAdjustments: adjustments,
      groupVisibility: createDefaultGroupVisibility()
    });

    expect(result?.adjustments.exposureEV).toBe(1.25);
    expect(target.setAdjustmentStack).not.toHaveBeenCalled();
    expect(target.setAdjustments).toHaveBeenCalledWith(
      expect.objectContaining({ exposureEV: 1.25 })
    );
  });

  it('keeps disabled adjustment groups out of renderer hydration', async () => {
    const target = renderer();
    const adjustments: BasicAdjustments = {
      ...createDefaultAdjustments(),
      exposureEV: 2
    };

    await hydrateDocumentSource({
      renderer: target,
      loaded: loadedSource(),
      initialAdjustments: adjustments,
      groupVisibility: {
        ...createDefaultGroupVisibility(),
        light: false
      }
    });

    expect(target.setAdjustments).toHaveBeenCalledWith(
      expect.objectContaining({ exposureEV: 0 })
    );
  });
});
