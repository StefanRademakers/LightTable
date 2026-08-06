import type {
  DocumentFontAsset,
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import { textFontPatch } from './textPropertyPresentation';
import { textFontSourceIdentity } from '../../text/fonts/textLayerFontStatus';
import type { RequestedFont, TextStyleRun } from '@lighttable/text-core';

const runRequestsFont = (
  run: Pick<TextStyleRun, 'requestedFont' | 'fontWeight' | 'fontStretch' | 'fontStyle'>,
  requestedFont: string
) => {
  const original = run.requestedFont.replacement?.original ?? run.requestedFont;
  return original.postScriptName === requestedFont || original.families.includes(requestedFont);
};

const sourceRequest = (requestedFont: RequestedFont) => {
  const original = requestedFont.replacement?.original ?? requestedFont;
  return {
    families: [...original.families],
    ...(original.postScriptName ? { postScriptName: original.postScriptName } : {}),
    ...(original.preferredAsset ? { preferredAsset: structuredClone(original.preferredAsset) } : {})
  };
};

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
  requestedFont?: string,
  sourceIdentity?: string
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
  const patch = textFontPatch(asset);
  const replaceRun = <Run extends Omit<TextStyleRun, 'start' | 'end'>>(run: Run): Run => {
    const identityMatches = !sourceIdentity || textFontSourceIdentity(run) === sourceIdentity;
    if (!identityMatches || (requestedFont && !runRequestsFont(run, requestedFont))) return run;
    const originalStyle = run.requestedFont.replacement?.originalStyle ?? {
      weight: run.fontWeight,
      stretch: run.fontStretch,
      fontStyle: run.fontStyle
    };
    const requested = patch.requestedFont!;
    return {
      ...run,
      ...patch,
      requestedFont: {
        ...requested,
        replacement: {
          original: sourceRequest(run.requestedFont),
          originalStyle,
          replacementAsset: structuredClone(requested.preferredAsset!)
        }
      }
    } as Run;
  };
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
  requestedFont?: string,
  sourceIdentity?: string
): ImageDocument => layerIds.reduce(
  (current, layerId) => replaceMissingTextFont(
    current, layerId, asset, requestedFont, sourceIdentity
  ),
  document
);
