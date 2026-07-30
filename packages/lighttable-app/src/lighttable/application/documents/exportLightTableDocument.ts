import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  rasterLayerCount,
  walkLayerTree
} from '../../editor/document/layerTree';
import {
  buildLayeredDocumentFile,
  type DocumentAssetBlob,
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
  exportLayerAssets(document: ImageDocument): Promise<DocumentAssetBlob[]>;
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
  preservedSourceAssets: readonly PreservedSourceAssetBlob[];
}

export interface ExportedLightTableDocument {
  file: File;
  recipe: LightTableRecipe;
}

export const buildLightTableOutputName = (base: string) =>
  `${base.replace(/\.[^.]+$/, '') || 'image'}-lighttable.png`;

/**
 * A single raster node has no native document state beyond its grade recipe.
 * Every other topology is persisted as a layered LightTable container.
 */
export const canExportAsFlatRecipe = (document: ImageDocument) =>
  rasterLayerCount(document) === 1
  && walkLayerTree(document.layers).length === 1
  && document.assets.preservedSources.length === 0;

export const exportLightTableDocument = async ({
  document,
  renderer,
  recipeSourceKey,
  fileNameBase,
  flatAdjustments,
  documentAdjustments,
  effectiveLayeredAdjustments,
  preservedSourceAssets
}: ExportLightTableDocumentOptions): Promise<ExportedLightTableDocument> => {
  const preview = await renderer.exportPng();
  const outputName = buildLightTableOutputName(fileNameBase);

  if (canExportAsFlatRecipe(document)) {
    return {
      file: new File([preview], outputName, { type: 'image/png' }),
      recipe: createLightTableRecipe(recipeSourceKey, flatAdjustments)
    };
  }

  const assets = [
    ...await renderer.exportLayerAssets(document),
    ...preservedSourceAssets
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
      outputName
    ),
    recipe: createLightTableRecipe(
      recipeSourceKey,
      effectiveLayeredAdjustments,
      'embedded-layered-png'
    )
  };
};
