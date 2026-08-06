import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { registerBundledTextFontByAssetId } from '../../text/fonts/bundledTextFont';
import { documentTextFontDiagnostics } from '../../text/fonts/textLayerFontStatus';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { MissingFontRecoveryRequest } from '../../editor/ui/useEditorDialogController';
import { replaceMissingTextFont, replaceMissingTextFonts } from './replaceMissingTextFont';

interface Dependencies {
  readonly documentId: string | null | undefined;
  readonly documentRef: MutableRefObject<ImageDocument | null>;
  readonly registry: DocumentFontRegistry;
  readonly substitutionFamilies: readonly string[];
  readonly applyDocument: (document: ImageDocument) => void;
  readonly recordHistory: (before: ImageDocument, after: ImageDocument) => void;
  readonly closeRecovery: () => void;
  readonly requestRecovery: (request: MissingFontRecoveryRequest) => void;
  readonly beginEditing: (layerId: LayerId, offset?: number, affinity?: 'upstream' | 'downstream') => void;
  readonly setStatus: (message: string) => void;
  readonly setError: (message: string) => void;
}

interface PreviewState {
  readonly before: ImageDocument;
  readonly layerId: LayerId;
  readonly sourceIdentity: string;
}

export const useMissingFontReplacementActions = (dependencies: Dependencies) => {
  const previewRef = useRef<PreviewState | null>(null);
  const generationRef = useRef(0);
  useEffect(() => {
    generationRef.current += 1;
    previewRef.current = null;
  }, [dependencies.documentId]);

  const resolveAsset = useCallback(async (assetId: string) => {
    const bundled = await registerBundledTextFontByAssetId(dependencies.registry, assetId);
    const asset = bundled
      ?? dependencies.registry.availableAssets.find((candidate) => candidate.assetId === assetId);
    if (!asset) throw new Error('The selected replacement font is not available.');
    return asset;
  }, [dependencies.registry]);

  const preview = useCallback((
    layerId: LayerId, assetId: string, sourceIdentity: string, requestedFont: string | null
  ) => {
    const generation = ++generationRef.current;
    void resolveAsset(assetId).then((asset) => {
      if (generation !== generationRef.current) return;
      const active = previewRef.current;
      const before = active?.layerId === layerId && active.sourceIdentity === sourceIdentity
        ? active.before : dependencies.documentRef.current;
      if (!before) return;
      previewRef.current = { before, layerId, sourceIdentity };
      const after = replaceMissingTextFont(
        before, layerId, asset, requestedFont ?? undefined, sourceIdentity
      );
      if (after !== before) dependencies.applyDocument(after);
    }).catch((reason: unknown) => dependencies.setError(
      reason instanceof Error ? reason.message : 'The replacement preview could not be applied.'
    ));
  }, [dependencies, resolveAsset]);

  const cancelPreview = useCallback(() => {
    generationRef.current += 1;
    const previewState = previewRef.current;
    previewRef.current = null;
    if (previewState) dependencies.applyDocument(previewState.before);
  }, [dependencies]);

  const replace = useCallback((
    layerId: LayerId, assetId: string, sourceIdentity: string, requestedFont: string | null,
    offset?: number, affinity?: 'upstream' | 'downstream'
  ) => {
    generationRef.current += 1;
    void resolveAsset(assetId).then((asset) => {
      const active = previewRef.current;
      const before = active?.layerId === layerId && active.sourceIdentity === sourceIdentity
        ? active.before : dependencies.documentRef.current;
      const layer = before ? findDocumentLayer(before, layerId) : null;
      if (!before || layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
      const after = replaceMissingTextFont(
        before, layerId, asset, requestedFont ?? undefined, sourceIdentity
      );
      previewRef.current = null;
      dependencies.closeRecovery();
      if (after !== before) {
        dependencies.applyDocument(after);
        dependencies.recordHistory(before, after);
      }
      const remaining = documentTextFontDiagnostics(
        after, dependencies.registry.availableAssets, dependencies.substitutionFamilies
      ).find((diagnostic) => diagnostic.layerId === layerId
        && diagnostic.issue !== 'missing-glyph' && diagnostic.sourceIdentity);
      if (remaining?.sourceIdentity) {
        dependencies.requestRecovery({
          layerId, sourceIdentity: remaining.sourceIdentity,
          requestedFont: remaining.requestedFont, layerName: remaining.layerName,
          metricsChanged: remaining.metricsChanged, offset, affinity
        });
      } else {
        dependencies.beginEditing(layerId, offset, affinity);
      }
      dependencies.setStatus(
        `Replaced the unavailable font with ${asset.familyNames[0] ?? asset.styleName}.`
      );
    }).catch((reason: unknown) => dependencies.setError(
      reason instanceof Error ? reason.message : 'The replacement font could not be applied.'
    ));
  }, [dependencies, resolveAsset]);

  const replaceDocument = useCallback((
    layerIds: readonly LayerId[], assetId: string, requestedFont: string, sourceIdentity: string
  ) => {
    void resolveAsset(assetId).then((asset) => {
      const before = dependencies.documentRef.current;
      if (!before) return;
      const after = replaceMissingTextFonts(
        before, layerIds, asset, requestedFont, sourceIdentity
      );
      if (after === before) return;
      dependencies.applyDocument(after);
      dependencies.recordHistory(before, after);
      dependencies.setStatus(
        `Replaced ${layerIds.length} ${layerIds.length === 1 ? 'layer' : 'layers'} with ${asset.familyNames[0] ?? asset.styleName}.`
      );
    }).catch((reason: unknown) => dependencies.setError(
      reason instanceof Error ? reason.message : 'The document font replacement could not be applied.'
    ));
  }, [dependencies, resolveAsset]);

  return { preview, cancelPreview, replace, replaceDocument };
};
