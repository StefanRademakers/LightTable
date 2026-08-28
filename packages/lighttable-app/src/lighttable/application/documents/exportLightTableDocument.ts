import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  rasterLayerCount,
  walkLayerTree
} from '../../editor/document/layerTree';
import {
  buildLayeredDocumentFile,
  type DocumentAssetBlob,
  type FontAssetBlob,
  type PreservedSourceAssetBlob
} from '../../editor/persistence/layeredDocumentFormat';
import {
  createLightTableRecipe,
  type LightTableRecipe
} from '../../lightTableRecipe';
import {
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import type { BasicAdjustments } from '../../types';

export interface DocumentExportRenderer {
  exportPng(): Promise<Blob>;
  exportRgba8?(): Promise<{
    readonly pixels: Uint8Array | Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly storage: 'u8';
  }>;
  exportRgba16?(): Promise<{
    readonly pixels: Uint16Array;
    readonly width: number;
    readonly height: number;
    readonly storage: 'f16-display';
  }>;
  exportLayerAssets(document: ImageDocument): Promise<DocumentAssetBlob[]>;
  exportPsdLayerAssets?(document: ImageDocument): Promise<DocumentAssetBlob[]>;
  getAdjustmentStack(): AdjustmentStack;
}

export interface ExportLightTableDocumentOptions {
  document: ImageDocument;
  renderer: DocumentExportRenderer;
  recipeSourceKey: string;
  fileNameBase: string;
  flatAdjustments: BasicAdjustments;
  documentAdjustments: BasicAdjustments;
  effectiveLayeredAdjustments: BasicAdjustments;
  globalGradeStrength?: number;
  preservedSourceAssets: readonly PreservedSourceAssetBlob[];
  fontAssets?: readonly FontAssetBlob[];
}

export interface ExportedLightTableDocument {
  file: File;
  recipe: LightTableRecipe;
}

export interface ExportLightTableRuntimeOptions {
  /** Recovery prioritizes canonical layer state over an expensive full-size thumbnail. */
  readonly lightweightPreview?: boolean;
  /** Workspace forks require authored pixels even for a single flat raster node. */
  readonly forceLayered?: boolean;
}

const lightweightPreview = async (): Promise<Blob> => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    if (!canvas.getContext('2d')) {
      throw new Error('Recovery placeholder canvas initialization failed.');
    }
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Recovery placeholder encoding failed.')),
    'image/png'
  ));
};

export const buildLightTableOutputName = (base: string) =>
  `${base.replace(/\.[^.]+$/, '') || 'image'}-lighttable.png`;

/**
 * A single raster node has no native document state beyond its grade recipe.
 * Every other topology is persisted as a layered LightTable container.
 */
export const canExportAsFlatRecipe = (document: ImageDocument) =>
  rasterLayerCount(document) === 1
  && walkLayerTree(document.layers).length === 1
  && document.assets.preservedSources.length === 0
  && document.assets.fonts.length === 0;

export const exportLightTableDocument = async ({
  document,
  renderer,
  recipeSourceKey,
  fileNameBase,
  flatAdjustments,
  documentAdjustments,
  effectiveLayeredAdjustments,
  globalGradeStrength = 100,
  preservedSourceAssets,
  fontAssets = []
}: ExportLightTableDocumentOptions, runtime: ExportLightTableRuntimeOptions = {}): Promise<ExportedLightTableDocument> => {
  const preview = runtime.lightweightPreview
    ? await lightweightPreview()
    : await renderer.exportPng();
  const outputName = buildLightTableOutputName(fileNameBase);

  if (!runtime.forceLayered && !runtime.lightweightPreview && canExportAsFlatRecipe(document)) {
    return {
      file: new File([preview], outputName, { type: 'image/png' }),
      recipe: createLightTableRecipe(recipeSourceKey, flatAdjustments, undefined, globalGradeStrength)
    };
  }

  const assets = [
    ...await renderer.exportLayerAssets(document),
    ...preservedSourceAssets,
    ...fontAssets
  ];
  const adjustmentStack = createAdjustmentStackFromBasicAdjustments(
    documentAdjustments,
    renderer.getAdjustmentStack()
  );
  return {
    file: buildLayeredDocumentFile(
      preview,
      document,
      adjustmentStack,
      assets,
      outputName,
      { previewKind: runtime.lightweightPreview ? 'placeholder' : 'composite' }
    ),
    recipe: createLightTableRecipe(
      recipeSourceKey,
      effectiveLayeredAdjustments,
      'embedded-layered-png',
      globalGradeStrength
    )
  };
};
