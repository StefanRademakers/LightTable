import type {
  FlowTextSource,
  TextWorkerFlowFontSelection
} from '@lighttable/text-core';
import type {
  DocumentFontAsset,
  ImageDocument,
  LayerNode
} from '../../editor/document/documentTypes';
import { resolveFontRequest } from './DocumentFontRegistry';

/** Ordered, explicit policy. No family outside this list is silently chosen. */
export const DEFAULT_TEXT_SUBSTITUTION_FAMILIES = Object.freeze([
  'Noto Sans',
  'Inter'
] as const);

const selectedFamilyName = (
  asset: DocumentFontAsset,
  preferredName?: string
) => asset.familyNames.find((family) => family === preferredName)
  ?? asset.familyNames[0]
  ?? asset.postScriptName
  ?? asset.assetId;

export interface FlowFontSelectionResult {
  readonly selections: readonly TextWorkerFlowFontSelection[];
  readonly missingSourceRunIndices: readonly number[];
}

/**
 * Resolves every authored style run against one immutable font snapshot.
 * Missing runs stay missing; substitutes are chosen only from the explicit
 * ordered policy and retain the original RequestedFont in their provenance.
 */
export const resolveFlowFontSelections = (
  source: FlowTextSource,
  assets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[] = DEFAULT_TEXT_SUBSTITUTION_FAMILIES
): FlowFontSelectionResult => {
  const selections: TextWorkerFlowFontSelection[] = [];
  const missingSourceRunIndices: number[] = [];
  source.styleRuns.forEach((run, sourceRunIndex) => {
    const resolution = resolveFontRequest(assets, run.requestedFont, {
      weight: run.fontWeight,
      stretch: run.fontStretch,
      italic: run.fontStyle !== 'normal'
    }, substitutionFamilies);
    if (resolution.kind === 'missing') {
      missingSourceRunIndices.push(sourceRunIndex);
      return;
    }
    const requested = structuredClone(run.requestedFont);
    selections.push({
      sourceRunIndex,
      font: resolution.asset,
      familyName: selectedFamilyName(
        resolution.asset,
        resolution.kind === 'substituted' ? resolution.substituteFamily : run.requestedFont.families[0]
      ),
      resolution: resolution.kind === 'substituted'
        ? { kind: 'flow-substituted', sourceRunIndex, requested, reason: 'asset-missing' }
        : { kind: 'flow-exact', sourceRunIndex, requested }
    });
  });
  return { selections, missingSourceRunIndices };
};

const visibleFlowTextNeedsFallback = (
  nodes: readonly LayerNode[],
  assets: readonly DocumentFontAsset[],
  inheritedVisible: boolean
): boolean => nodes.some((node) => {
  const visible = inheritedVisible && node.visible && node.opacity > 0;
  if (!visible) return false;
  if (node.type === 'group') {
    return visibleFlowTextNeedsFallback(node.children, assets, visible);
  }
  return node.type === 'text'
    && node.text.source.kind === 'flow'
    && resolveFlowFontSelections(node.text.source, assets).missingSourceRunIndices.length > 0;
});

/** Keeps bundled fallback bytes cold until visible flow text truly needs them. */
export const documentNeedsFlowFontFallback = (
  document: ImageDocument,
  assets: readonly DocumentFontAsset[]
) => visibleFlowTextNeedsFallback(document.layers, assets, true);
