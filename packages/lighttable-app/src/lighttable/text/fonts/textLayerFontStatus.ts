import type {
  DocumentFontAsset,
  ImageDocument,
  TextLayer
} from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';
import { resolveFontRequest, type FontResolution } from './DocumentFontRegistry';

export interface TextLayerFontStatus {
  readonly kind: 'exact' | 'substituted' | 'missing';
  readonly label: string;
  readonly detail: string;
}

const summarize = (resolutions: readonly FontResolution[]): TextLayerFontStatus => {
  const missing = resolutions.find((entry) => entry.kind === 'missing');
  if (missing?.kind === 'missing') {
    const requested = missing.postScriptName
      ?? (missing.requestedFamilies.join(', ') || 'Unknown font');
    const preferred = missing.preferredAsset
      ? `; requested=${missing.preferredAsset.fingerprintSha256}:${missing.preferredAsset.faceIndex}`
      : '';
    return {
      kind: 'missing',
      label: 'Missing font',
      detail: `Missing font: ${requested}${preferred}; chosen=none; source=unavailable; `
        + 'reason=no available exact face'
    };
  }
  const substituted = resolutions.find((entry) => entry.kind === 'substituted');
  if (substituted?.kind === 'substituted') {
    return {
      kind: 'substituted',
      label: 'Substituted',
      detail: `${substituted.requestedFamilies.join(', ')} -> ${substituted.substituteFamily}; `
        + `chosen=${substituted.asset.fingerprintSha256}:${substituted.asset.faceIndex}; `
        + `source=${substituted.asset.source}; reason=explicit substitution`
    };
  }
  return { kind: 'exact', label: 'Font exact', detail: 'All text fonts resolve exactly.' };
};

export const textLayerFontStatus = (
  layer: TextLayer,
  assets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[] = []
): TextLayerFontStatus => {
  if (layer.text.source.kind === 'flow') {
    return summarize(layer.text.source.styleRuns.map((run) => resolveFontRequest(
      assets,
      run.requestedFont,
      {
        weight: run.fontWeight,
        stretch: run.fontStretch,
        italic: run.fontStyle !== 'normal'
      },
      substitutionFamilies
    )));
  }
  const resolutions: FontResolution[] = layer.text.source.runs.map((run) => {
    const asset = assets.find((candidate) =>
      candidate.fingerprintSha256 === run.font.font.fingerprintSha256
      && candidate.faceIndex === run.font.font.faceIndex
    );
    return asset
      ? { kind: 'exact', asset, matchedBy: 'preferred-asset' }
      : {
          kind: 'missing',
          requestedFamilies: [],
          ...(run.font.font.postScriptName ? { postScriptName: run.font.font.postScriptName } : {}),
          preferredAsset: run.font.font
        };
  });
  return summarize(resolutions);
};

export interface TextFontDiagnostic {
  readonly layerId: TextLayer['id'];
  readonly layerName: string;
  readonly status: TextLayerFontStatus & { readonly kind: 'substituted' | 'missing' };
}

export const summarizeTextFontDiagnostics = (
  diagnostics: readonly TextFontDiagnostic[]
) => {
  const missing = diagnostics.filter((entry) => entry.status.kind === 'missing').length;
  const substituted = diagnostics.length - missing;
  return [
    missing ? (missing === 1
      ? '1 text layer has a missing font'
      : `${missing} text layers have missing fonts`) : '',
    substituted ? `${substituted} ${substituted === 1 ? 'uses' : 'use'} explicit font substitution` : ''
  ].filter(Boolean).join(' · ');
};

export const documentTextFontDiagnostics = (
  document: ImageDocument,
  availableAssets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[] = []
): TextFontDiagnostic[] => walkLayerTree(document.layers)
  .map((entry) => entry.node)
  .filter((node): node is TextLayer => node.type === 'text')
  .map((node) => ({
    layerId: node.id,
    layerName: node.name,
    status: textLayerFontStatus(node, availableAssets, substitutionFamilies)
  }))
  .filter((entry): entry is TextFontDiagnostic => entry.status.kind !== 'exact');
