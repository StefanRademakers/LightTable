import type {
  DocumentFontAsset,
  ImageDocument,
  TextLayer
} from '../../editor/document/documentTypes';
import type { RealizedTextLayout } from '@lighttable/text-core';
import type { RequestedFont, TextStyleRun } from '@lighttable/text-core';
import { walkLayerTree } from '../../editor/document/layerTree';
import { resolveFontRequest, type FontResolution } from './DocumentFontRegistry';

export interface TextLayerFontStatus {
  readonly kind: 'exact' | 'substituted' | 'missing';
  readonly label: string;
  readonly detail: string;
}

export interface TextFontSourceIdentityInput {
  readonly requestedFont: RequestedFont;
  readonly fontWeight: number;
  readonly fontStretch: number;
  readonly fontStyle: TextStyleRun['fontStyle'];
}

const originalFontRequest = (requested: RequestedFont) => (
  requested.replacement?.original ?? requested
);

/** Stable authored-face identity; intentionally independent of layer/run order. */
export const textFontSourceIdentity = (input: TextFontSourceIdentityInput): string => {
  const request = originalFontRequest(input.requestedFont);
  const originalStyle = input.requestedFont.replacement?.originalStyle;
  const preferred = request.preferredAsset
    ? `${request.preferredAsset.fingerprintSha256.toLowerCase()}:${request.preferredAsset.faceIndex}`
    : '';
  return JSON.stringify({
    preferred,
    postScriptName: request.postScriptName?.trim().toLocaleLowerCase() ?? '',
    families: request.families.map((family) => family.trim().toLocaleLowerCase()),
    weight: originalStyle?.weight ?? input.fontWeight,
    stretch: originalStyle?.stretch ?? input.fontStretch,
    fontStyle: originalStyle?.fontStyle ?? input.fontStyle
  });
};

export const textFontSourceMetrics = (sourceIdentity: string | null) => {
  if (!sourceIdentity?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(sourceIdentity) as Record<string, unknown>;
    if (typeof parsed.weight !== 'number' || typeof parsed.stretch !== 'number'
      || !['normal', 'italic', 'oblique'].includes(String(parsed.fontStyle))) return null;
    return {
      weight: parsed.weight,
      stretch: parsed.stretch,
      fontStyle: parsed.fontStyle as TextStyleRun['fontStyle']
    };
  } catch {
    return null;
  }
};

export interface TextLayerFontResolution {
  readonly runIndex: number;
  readonly start: number;
  readonly end: number;
  readonly sourceIdentity: string;
  readonly request: RequestedFont;
  readonly resolution: FontResolution;
  readonly metricsChanged: boolean;
}

export const textLayerFontResolutions = (
  layer: TextLayer,
  assets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[] = []
): TextLayerFontResolution[] => {
  if (layer.text.source.kind !== 'flow') return [];
  return layer.text.source.styleRuns.map((run, runIndex) => {
    const resolution = resolveFontRequest(assets, run.requestedFont, {
      weight: run.fontWeight,
      stretch: run.fontStretch,
      italic: run.fontStyle !== 'normal'
    }, substitutionFamilies);
    const replacement = run.requestedFont.replacement;
    return {
      runIndex,
      start: run.start,
      end: run.end,
      sourceIdentity: textFontSourceIdentity(run),
      request: run.requestedFont,
      resolution,
      metricsChanged: Boolean(replacement && (
        replacement.originalStyle.weight !== run.fontWeight
        || replacement.originalStyle.stretch !== run.fontStretch
        || replacement.originalStyle.fontStyle !== run.fontStyle
      ))
    };
  });
};

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
    return summarize(textLayerFontResolutions(layer, assets, substitutionFamilies)
      .map((entry) => entry.resolution));
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
  readonly editable: boolean;
  readonly issue: 'font-missing' | 'font-substituted' | 'missing-glyph';
  readonly requestedFont: string | null;
  readonly sourceIdentity: string | null;
  readonly runIndices: readonly number[];
  readonly metricsChanged: boolean;
  readonly status: TextLayerFontStatus & { readonly kind: 'substituted' | 'missing' };
}

const requestedFontLabel = (
  layer: TextLayer,
  assets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[],
  issueKind?: 'missing' | 'substituted'
): string | null => {
  if (layer.text.source.kind === 'flow') {
    for (const run of layer.text.source.styleRuns) {
      const resolution = resolveFontRequest(assets, run.requestedFont, {
        weight: run.fontWeight,
        stretch: run.fontStretch,
        italic: run.fontStyle !== 'normal'
      }, substitutionFamilies);
      if (issueKind && resolution.kind !== issueKind) continue;
      const label = run.requestedFont.postScriptName
        ?? run.requestedFont.families.find(Boolean);
      if (label) return label;
    }
    return null;
  }
  return layer.text.source.runs.find((run) => run.font.font.postScriptName)
    ?.font.font.postScriptName ?? null;
};

export const summarizeTextFontDiagnostics = (
  diagnostics: readonly TextFontDiagnostic[]
) => {
  const countLayers = (predicate: (entry: TextFontDiagnostic) => boolean) => new Set(
    diagnostics.filter(predicate).map((entry) => entry.layerId)
  ).size;
  const missingGlyphs = countLayers((entry) => entry.issue === 'missing-glyph');
  const missingFonts = countLayers((entry) => entry.issue === 'font-missing');
  const substituted = countLayers((entry) => entry.issue === 'font-substituted');
  return [
    missingFonts ? (missingFonts === 1
      ? '1 text layer has a missing font'
      : `${missingFonts} text layers have missing fonts`) : '',
    missingGlyphs ? `${missingGlyphs} ${missingGlyphs === 1 ? 'text layer has' : 'text layers have'} missing glyphs` : '',
    substituted ? `${substituted} ${substituted === 1 ? 'uses' : 'use'} explicit font substitution` : ''
  ].filter(Boolean).join(' · ');
};

export const documentTextFontDiagnostics = (
  document: ImageDocument,
  availableAssets: readonly DocumentFontAsset[],
  substitutionFamilies: readonly string[] = [],
  layoutFor?: (layerId: TextLayer['id']) => RealizedTextLayout | null
): TextFontDiagnostic[] => walkLayerTree(document.layers)
  .map((entry) => entry.node)
  .filter((node): node is TextLayer => node.type === 'text')
  .flatMap((node): TextFontDiagnostic[] => {
    const editable = node.text.source.kind === 'flow';
    const diagnostics: TextFontDiagnostic[] = [];
    const issueGroups = new Map<string, TextLayerFontResolution[]>();
    textLayerFontResolutions(node, availableAssets, substitutionFamilies).forEach((entry) => {
      if (entry.resolution.kind === 'exact') return;
      const key = `${entry.resolution.kind}:${entry.sourceIdentity}`;
      issueGroups.set(key, [...(issueGroups.get(key) ?? []), entry]);
    });
    issueGroups.forEach((entries) => {
      const first = entries[0]!;
      const status = summarize(entries.map((entry) => entry.resolution));
      if (status.kind !== 'missing' && status.kind !== 'substituted') return;
      const original = originalFontRequest(first.request);
      diagnostics.push({
        layerId: node.id,
        layerName: node.name,
        editable,
        issue: status.kind === 'missing' ? 'font-missing' : 'font-substituted',
        requestedFont: original.postScriptName ?? original.families.find(Boolean) ?? null,
        sourceIdentity: first.sourceIdentity,
        runIndices: entries.map((entry) => entry.runIndex),
        metricsChanged: entries.some((entry) => entry.metricsChanged),
        status: { ...status, kind: status.kind }
      });
    });
    if (node.text.source.kind === 'positioned') {
      const positionedGroups = new Map<string, number[]>();
      node.text.source.runs.forEach((run, runIndex) => {
        const available = availableAssets.some((candidate) => (
          candidate.fingerprintSha256 === run.font.font.fingerprintSha256
          && candidate.faceIndex === run.font.font.faceIndex
        ));
        if (available) return;
        const identity = `positioned:${run.font.font.fingerprintSha256.toLowerCase()}:${run.font.font.faceIndex}`;
        positionedGroups.set(identity, [...(positionedGroups.get(identity) ?? []), runIndex]);
      });
      positionedGroups.forEach((runIndices, sourceIdentity) => {
        const run = node.text.source.kind === 'positioned'
          ? node.text.source.runs[runIndices[0]!] : null;
        if (!run) return;
        const requestedFont = run.font.font.postScriptName ?? null;
        diagnostics.push({
          layerId: node.id,
          layerName: node.name,
          editable: false,
          issue: 'font-missing',
          requestedFont,
          sourceIdentity,
          runIndices,
          metricsChanged: false,
          status: {
            kind: 'missing', label: 'Missing font',
            detail: `Missing positioned font: ${requestedFont ?? sourceIdentity}; chosen=none; source=unavailable`
          }
        });
      });
    }
    const missingGlyphWarnings = layoutFor?.(node.id)?.warnings.filter(
      (warning) => warning.code === 'missing-glyph'
    ) ?? [];
    if (missingGlyphWarnings.length > 0) {
      diagnostics.push({
        layerId: node.id,
        layerName: node.name,
        editable,
        issue: 'missing-glyph',
        requestedFont: requestedFontLabel(node, availableAssets, substitutionFamilies),
        sourceIdentity: null,
        runIndices: missingGlyphWarnings.flatMap((warning) => (
          warning.runIndex === undefined ? [] : [warning.runIndex]
        )),
        metricsChanged: false,
        status: {
          kind: 'missing',
          label: 'Missing glyph',
          detail: missingGlyphWarnings.map((warning) => (
            `${warning.message}${warning.runIndex === undefined ? '' : ` (run ${warning.runIndex + 1})`}`
          )).join('; ')
        }
      });
    }
    return diagnostics;
  });
