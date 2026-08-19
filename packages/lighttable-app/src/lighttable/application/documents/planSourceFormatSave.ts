import { isIdentityAffineMatrix } from '@lighttable/vector-core';
import type { ImageDocument, RasterLayer } from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import { createDefaultAdjustments } from '../../types';

export type SourceFormatSaveKind = 'png' | 'jpeg';

export type SourceFormatSaveBlocker =
  | 'no-replaceable-source'
  | 'unsupported-source-format'
  | 'unsupported-bit-depth'
  | 'document-structure'
  | 'document-metadata'
  | 'live-document-processing'
  | 'live-layer-semantics';

export type SourceFormatSavePlan =
  | {
      readonly kind: 'replace-source';
      readonly format: SourceFormatSaveKind;
      readonly sourcePath: string;
      readonly sourceName: string;
      readonly mediaType: 'image/png' | 'image/jpeg';
    }
  | {
      readonly kind: 'lighttable-document';
      readonly blockers: readonly SourceFormatSaveBlocker[];
    };

export interface SourceFormatSaveSource {
  readonly name: string;
  readonly type: string;
  readonly sourcePath?: string;
}

export interface PlanSourceFormatSaveOptions {
  readonly document: ImageDocument;
  readonly source: SourceFormatSaveSource | null;
  readonly flatAdjustments: BasicAdjustments;
  readonly documentAdjustments: BasicAdjustments;
}

const sourceFormat = (source: SourceFormatSaveSource): SourceFormatSaveKind | null => {
  const extension = /\.([^.]+)$/.exec(source.name)?.[1]?.toLocaleLowerCase('en-US');
  if (extension === 'png' && (!source.type || source.type === 'image/png')) return 'png';
  if ((extension === 'jpg' || extension === 'jpeg')
    && (!source.type || source.type === 'image/jpeg')) return 'jpeg';
  return null;
};

const adjustmentsAreNeutral = (adjustments: BasicAdjustments): boolean =>
  JSON.stringify(adjustments) === JSON.stringify(createDefaultAdjustments());

const rasterHasOnlyFlattenedSemantics = (
  layer: RasterLayer,
  document: ImageDocument
): boolean => layer.visible
  && layer.opacity === 1
  && layer.fillOpacity === 1
  && layer.blendMode === 'normal'
  && !layer.clipping
  && !Object.values(layer.locks).some(Boolean)
  && layer.styleStack.effects.length === 0
  && layer.adjustmentStack === null
  && (layer.attachedAdjustments?.length ?? 0) === 0
  && layer.mask === null
  && layer.derivedPreview == null
  && layer.photoshop == null
  && isIdentityAffineMatrix(layer.transform)
  && layer.offsetX === 0
  && layer.offsetY === 0
  && layer.width === document.width
  && layer.height === document.height;

/**
 * Chooses whether ordinary Save may replace the original flat raster.
 *
 * This checks current authored state, not edit history. Flatten Image bakes
 * live processing into one neutral full-canvas raster and therefore makes the
 * document eligible again. Any still-editable LightTable semantics fail
 * closed to the layered document writer.
 */
export const planSourceFormatSave = ({
  document,
  source,
  flatAdjustments,
  documentAdjustments
}: PlanSourceFormatSaveOptions): SourceFormatSavePlan => {
  const blockers: SourceFormatSaveBlocker[] = [];
  if (!source?.sourcePath) blockers.push('no-replaceable-source');
  const format = source ? sourceFormat(source) : null;
  if (!format) blockers.push('unsupported-source-format');
  if (document.colorSettings.bitDepth !== 8) blockers.push('unsupported-bit-depth');

  const layer = document.layers.length === 1 && document.layers[0]?.type === 'raster'
    ? document.layers[0]
    : null;
  if (!layer) blockers.push('document-structure');
  else if (!rasterHasOnlyFlattenedSemantics(layer, document)) blockers.push('live-layer-semantics');

  if (
    document.guides.length > 0
    || document.photoshopImportReport !== null
    || document.photoshopDocument !== null
    || document.assets.patterns.length > 0
    || document.assets.colorLookups.length > 0
    || document.assets.preservedSources.length > 0
    || document.assets.fonts.length > 0
  ) blockers.push('document-metadata');

  if (!adjustmentsAreNeutral(flatAdjustments) || !adjustmentsAreNeutral(documentAdjustments)) {
    blockers.push('live-document-processing');
  }

  if (blockers.length || !source?.sourcePath || !format) {
    return { kind: 'lighttable-document', blockers: [...new Set(blockers)] };
  }
  return {
    kind: 'replace-source',
    format,
    sourcePath: source.sourcePath,
    sourceName: source.name,
    mediaType: format === 'png' ? 'image/png' : 'image/jpeg'
  };
};
