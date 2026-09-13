import { useEffect, useRef } from 'react';
import type { DocumentFontAsset, ImageDocument } from '../../editor/document/documentTypes';
import type { ToolId } from '../../editor/session/editorSession';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { registerBundledTextFontsForDocument } from '../../text/fonts/bundledTextFont';
import { documentNeedsFlowFontFallback } from '../../text/fonts/flowFontSelection';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';

type AppendDiagnostic = (
  severity: 'info' | 'warning' | 'error',
  source: string,
  message: string,
  details?: string
) => void;

/** Owns lazy text-engine/font preparation and deduplicated font diagnostics. */
export const useTextFontLifecycle = ({
  activeTool,
  sourceReadyId,
  document,
  hydrationPending,
  availableAssets,
  diagnostics,
  registry,
  probeEngine,
  reportError,
  appendDiagnostic
}: {
  readonly activeTool: ToolId;
  readonly sourceReadyId: string | null;
  readonly document: ImageDocument | null;
  readonly hydrationPending: boolean;
  readonly availableAssets: readonly DocumentFontAsset[];
  readonly diagnostics: readonly TextFontDiagnostic[];
  readonly registry: DocumentFontRegistry;
  readonly probeEngine: () => Promise<unknown>;
  readonly reportError: (message: string) => void;
  readonly appendDiagnostic: AppendDiagnostic;
}): void => {
  const latest = useRef({ probeEngine, reportError, appendDiagnostic });
  latest.current = { probeEngine, reportError, appendDiagnostic };

  useEffect(() => {
    let activeRegistration = true;
    const typeToolActive = activeTool === 'text-point' || activeTool === 'text-vertical';
    if (!sourceReadyId && !typeToolActive) return undefined;
    void latest.current.probeEngine().catch((reason: unknown) => {
      if (activeRegistration && typeToolActive) {
        latest.current.reportError(reason instanceof Error
          ? reason.message
          : 'The bundled text engine could not be prepared.');
      }
    });
    return () => { activeRegistration = false; };
  }, [activeTool, sourceReadyId, registry]);

  useEffect(() => {
    if (!document || hydrationPending) return;
    if (!documentNeedsFlowFontFallback(document, availableAssets)) return;
    let current = true;
    void registerBundledTextFontsForDocument(registry, document).catch((reason: unknown) => {
      if (!current) return;
      latest.current.appendDiagnostic(
        'error',
        'Text fonts',
        reason instanceof Error ? reason.message : 'The bundled fallback font could not be loaded.'
      );
    });
    return () => { current = false; };
  }, [availableAssets, document, hydrationPending, registry]);

  const reportedSignatureRef = useRef('');
  useEffect(() => {
    const signature = `${document?.id ?? 'no-document'}:${JSON.stringify(diagnostics)}`;
    if (signature === reportedSignatureRef.current) return;
    reportedSignatureRef.current = signature;
    diagnostics.forEach(({ layerId, layerName, status }) => {
      latest.current.appendDiagnostic(
        'warning',
        'Text fonts',
        `${status.label}: ${layerName}`,
        `layer=${layerId}; ${status.detail}`
      );
    });
  }, [diagnostics, document?.id]);
};
