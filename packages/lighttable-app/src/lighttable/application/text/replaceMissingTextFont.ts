import type {
  DocumentFontAsset,
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import { textFontPatch } from './textPropertyPresentation';

const runRequestsFont = (
  run: { readonly requestedFont: { readonly postScriptName?: string; readonly families: readonly string[] } },
  requestedFont: string
) => run.requestedFont.postScriptName === requestedFont
  || run.requestedFont.families.includes(requestedFont);

/**
 * Replaces every authored run of one editable flow-text layer.
 *
 * The command deliberately routes through the canonical text mutation path so
 * revisions, locks, derived-preview invalidation and persistence all observe
 * the same atomic edit as the property bar.
 */
export const replaceMissingTextFont = (
  document: ImageDocument,
  layerId: LayerId,
  asset: DocumentFontAsset,
  requestedFont?: string
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
  const patch = textFontPatch(asset);
  const replaceRun = <Run extends {
    readonly requestedFont: {
      readonly postScriptName?: string;
      readonly families: readonly string[];
    };
  }>(run: Run): Run => (
    !requestedFont || runRequestsFont(run, requestedFont)
      ? { ...run, ...patch }
      : run
  ) as Run;
  const changed = applyTextLayerDataMutation(document, layerId, {
    ...layer.text,
    source: {
      ...layer.text.source,
      styleRuns: layer.text.source.styleRuns.map(replaceRun),
      ...(layer.text.source.insertionStyle ? {
        insertionStyle: replaceRun(layer.text.source.insertionStyle)
      } : {})
    }
  });
  if (changed === document || changed.assets.fonts.some((font) =>
    font.fingerprintSha256 === asset.fingerprintSha256 && font.faceIndex === asset.faceIndex
  )) return changed;
  return {
    ...changed,
    assets: {
      ...changed.assets,
      fonts: [...changed.assets.fonts, structuredClone(asset)]
    }
  };
};

/** Replaces a document font across several editable layers as one snapshot. */
export const replaceMissingTextFonts = (
  document: ImageDocument,
  layerIds: readonly LayerId[],
  asset: DocumentFontAsset,
  requestedFont?: string
): ImageDocument => layerIds.reduce(
  (current, layerId) => replaceMissingTextFont(current, layerId, asset, requestedFont),
  document
);
