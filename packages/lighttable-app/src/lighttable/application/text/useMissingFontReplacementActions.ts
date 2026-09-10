import { useCallback, useEffect, useRef } from 'react';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { registerBundledTextFontByAssetId } from '../../text/fonts/bundledTextFont';
import { documentTextFontDiagnostics } from '../../text/fonts/textLayerFontStatus';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { MissingFontRecoveryRequest } from '../../editor/ui/useEditorDialogController';
import { replaceMissingTextFont, replaceMissingTextFonts } from './replaceMissingTextFont';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

interface Dependencies {
  readonly documentId: string | null | undefined;
  readonly getDocument: () => ImageDocument | null;
  readonly registry: DocumentFontRegistry;
  readonly substitutionFamilies: readonly string[];
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  readonly closeRecovery: () => void;
  readonly requestRecovery: (request: MissingFontRecoveryRequest) => void;
  readonly beginEditing: (layerId: LayerId, offset?: number, affinity?: 'upstream' | 'downstream') => void;
  readonly setStatus: (message: string) => void;
  readonly setError: (message: string) => void;
}

interface PreviewState {
  readonly layerId: LayerId;
  readonly sourceIdentity: string;
  readonly transaction: DocumentMutationTransaction;
}

export const useMissingFontReplacementActions = (dependencies: Dependencies) => {
  const previewRef = useRef<PreviewState | null>(null);
  const generationRef = useRef(0);
  useEffect(() => {
    generationRef.current += 1;
    previewRef.current?.transaction.cancel();
    previewRef.current = null;
    return () => {
      generationRef.current += 1;
      previewRef.current?.transaction.cancel();
      previewRef.current = null;
    };
  }, [dependencies.documentId]);

  const notifyAfterCommit = useCallback((notify: () => void) => {
    try {
      notify();
    } catch (error) {
      dependencies.setError(error instanceof Error
        ? `The font replacement committed, but its UI update failed: ${error.message}`
        : 'The font replacement committed, but its UI update failed.');
    }
  }, [dependencies]);

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
    const openingDocument = dependencies.getDocument();
    if (!openingDocument) return Promise.resolve();
    const generation = ++generationRef.current;
    return resolveAsset(assetId).then((asset) => {
      if (generation !== generationRef.current
        || dependencies.getDocument() !== openingDocument) return;
      const active = previewRef.current;
      const matching = active?.layerId === layerId && active.sourceIdentity === sourceIdentity
        && active.transaction.active && active.transaction.before === openingDocument ? active : null;
      if (active && !matching) active.transaction.cancel();
      const transaction = matching?.transaction ?? dependencies.documentMutations.begin(
        `text-font-preview:${layerId}`,
        { label: 'Replace Missing Font', type: 'text.font.replace', layerIds: [layerId] },
        undefined,
        'cancel'
      );
      if (!transaction) return;
      if (transaction.before !== openingDocument) {
        transaction.cancel();
        return;
      }
      const before = transaction.before;
      const after = replaceMissingTextFont(
        before, layerId, asset, requestedFont ?? undefined, sourceIdentity
      );
      if (after === before) {
        transaction.cancel();
        previewRef.current = null;
        return;
      }
      previewRef.current = { layerId, sourceIdentity, transaction };
      if (!transaction.change(() => after)) {
        transaction.cancel();
        previewRef.current = null;
      }
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return;
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The replacement preview could not be applied.'
      );
    });
  }, [dependencies, resolveAsset]);

  const cancelPreview = useCallback(() => {
    generationRef.current += 1;
    const previewState = previewRef.current;
    previewRef.current = null;
    previewState?.transaction.cancel();
  }, [dependencies]);

  const replace = useCallback((
    layerId: LayerId, assetId: string, sourceIdentity: string, requestedFont: string | null,
    offset?: number, affinity?: 'upstream' | 'downstream'
  ) => {
    const openingDocument = dependencies.getDocument();
    if (!openingDocument) return Promise.resolve();
    const generation = ++generationRef.current;
    return resolveAsset(assetId).then((asset) => {
      if (generation !== generationRef.current
        || dependencies.getDocument() !== openingDocument) return;
      const active = previewRef.current;
      const matching = active?.layerId === layerId && active.sourceIdentity === sourceIdentity
        && active.transaction.active && active.transaction.before === openingDocument ? active : null;
      if (active && !matching) active.transaction.cancel();
      const transaction = matching?.transaction ?? dependencies.documentMutations.begin(
        `text-font-replace:${layerId}`,
        { label: 'Replace Missing Font', type: 'text.font.replace', layerIds: [layerId] },
        undefined,
        'cancel'
      );
      if (!transaction) return;
      if (transaction.before !== openingDocument) {
        transaction.cancel();
        return;
      }
      const before = transaction.before;
      const layer = before ? findDocumentLayer(before, layerId) : null;
      if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') {
        transaction.cancel();
        return;
      }
      const after = replaceMissingTextFont(
        before, layerId, asset, requestedFont ?? undefined, sourceIdentity
      );
      previewRef.current = null;
      if (after === before) {
        transaction.cancel();
        return;
      }
      if (!transaction.stage(() => after) || !transaction.commit()) return;
      notifyAfterCommit(() => {
        dependencies.closeRecovery();
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
      });
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return;
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The replacement font could not be applied.'
      );
    });
  }, [dependencies, notifyAfterCommit, resolveAsset]);

  const replaceDocument = useCallback((
    layerIds: readonly LayerId[], assetId: string, requestedFont: string, sourceIdentity: string
  ) => {
    const openingDocument = dependencies.getDocument();
    if (!openingDocument) return Promise.resolve();
    const generation = ++generationRef.current;
    previewRef.current?.transaction.cancel();
    previewRef.current = null;
    return resolveAsset(assetId).then((asset) => {
      if (generation !== generationRef.current
        || dependencies.getDocument() !== openingDocument) return;
      const changed = dependencies.documentMutations.change(
        (before) => before === openingDocument
          ? replaceMissingTextFonts(before, layerIds, asset, requestedFont, sourceIdentity)
          : before,
        true,
        { label: 'Replace Missing Fonts', type: 'text.font.replace-document', layerIds }
      );
      if (!changed) return;
      notifyAfterCommit(() => dependencies.setStatus(
        `Replaced ${layerIds.length} ${layerIds.length === 1 ? 'layer' : 'layers'} with ${asset.familyNames[0] ?? asset.styleName}.`
      ));
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return;
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The document font replacement could not be applied.'
      );
    });
  }, [dependencies, notifyAfterCommit, resolveAsset]);

  return { preview, cancelPreview, replace, replaceDocument };
};
