import type { DocumentFontAsset, LayerNode } from '../document/documentTypes';
import type { DocumentCapabilityFinding } from '../compatibility/documentCapabilityFindings';
import { primaryLayerCapabilityFinding } from '../compatibility/documentCapabilityFindings';
import { DEFAULT_TEXT_SUBSTITUTION_FAMILIES } from '../../text/fonts/flowFontSelection';
import { textLayerFontStatus, type TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';

export const layerCompatibilityPresentation = (
  layer: LayerNode,
  diagnostics: readonly TextFontDiagnostic[],
  fonts: readonly DocumentFontAsset[],
  findings: readonly DocumentCapabilityFinding[]
) => ({
  fontStatus: layer.type === 'text'
    ? diagnostics.find((entry) => entry.layerId === layer.id && entry.issue === 'missing-glyph')
      ?.status ?? textLayerFontStatus(layer, fonts, DEFAULT_TEXT_SUBSTITUTION_FAMILIES)
    : null,
  finding: primaryLayerCapabilityFinding(findings, layer.id)
});
