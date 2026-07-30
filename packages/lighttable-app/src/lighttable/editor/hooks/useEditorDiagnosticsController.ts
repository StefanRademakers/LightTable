import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import {
  formatStartupTimings,
  type LightTableStartupTimings
} from '../../application/telemetry/editorTelemetry';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from '../psd/psdDocumentAdapter';
import type {
  LightTableDebugMessage,
  LightTableDebugSeverity
} from '../debug/debugLog';

interface EditorDiagnosticsControllerOptions {
  error: string | null;
  scopeError: string | null;
  gradeStatus: string | null;
  startupTimings: LightTableStartupTimings | null;
  sourceName: string;
  psdImportInfo: PsdDecodeSuccess | null;
  psdCompatibility: readonly PsdImportCompatibilityEntry[];
  psdDifferenceMetrics: ReferenceDifferenceMetrics | null;
  onDocumentReady?: () => void;
  onDocumentError?: (message: string) => void;
}

export interface EditorDiagnosticsController {
  messages: readonly LightTableDebugMessage[];
  photoshopCompatibilitySummary: string;
  append(
    severity: LightTableDebugSeverity,
    source: string,
    message: string,
    details?: string
  ): void;
  clear(): void;
}

export const summarizePsdCompatibility = (
  compatibility: readonly PsdImportCompatibilityEntry[]
): string => {
  const counts = new Map<PsdImportCompatibilityEntry['support'], number>();
  compatibility.forEach(({ support }) => {
    counts.set(support, (counts.get(support) ?? 0) + 1);
  });
  return [
    ['native', 'native'],
    ['approximate', 'approximate'],
    ['raster-preview', 'preview-backed'],
    ['preserved', 'preserved/no-op'],
    ['placeholder', 'transparent placeholder']
  ].map(([support, label]) => {
    const count = counts.get(support as PsdImportCompatibilityEntry['support']) ?? 0;
    return count > 0 ? `${count} ${label}` : null;
  }).filter(Boolean).join('; ');
};

/**
 * Converts document-local runtime signals into a bounded, copyable debug log.
 * Hosts receive only terminal ready/error notifications and do not own editor
 * diagnostics or PSD compatibility formatting.
 */
export const useEditorDiagnosticsController = ({
  error,
  scopeError,
  gradeStatus,
  startupTimings,
  sourceName,
  psdImportInfo,
  psdCompatibility,
  psdDifferenceMetrics,
  onDocumentReady,
  onDocumentError
}: EditorDiagnosticsControllerOptions): EditorDiagnosticsController => {
  const nextMessageIdRef = useRef(1);
  const onDocumentReadyRef = useRef(onDocumentReady);
  const onDocumentErrorRef = useRef(onDocumentError);
  onDocumentReadyRef.current = onDocumentReady;
  onDocumentErrorRef.current = onDocumentError;
  const [messages, setMessages] = useState<LightTableDebugMessage[]>([]);
  const photoshopCompatibilitySummary = useMemo(
    () => summarizePsdCompatibility(psdCompatibility),
    [psdCompatibility]
  );

  const append = useCallback((
    severity: LightTableDebugSeverity,
    source: string,
    message: string,
    details?: string
  ) => {
    setMessages((current) => {
      const previous = current.at(-1);
      if (
        previous
        && previous.severity === severity
        && previous.source === source
        && previous.message === message
        && previous.details === details
        && Date.now() - previous.timestamp < 250
      ) {
        return current;
      }
      return [...current.slice(-499), {
        id: nextMessageIdRef.current++,
        timestamp: Date.now(),
        severity,
        source,
        message,
        details
      }];
    });
  }, []);

  useEffect(() => {
    if (!error) return;
    append('error', 'LightTable', error);
    onDocumentErrorRef.current?.(error);
  }, [append, error]);

  useEffect(() => {
    if (scopeError) append('error', 'Scopes', scopeError);
  }, [append, scopeError]);

  useEffect(() => {
    if (gradeStatus) append('info', 'Status', gradeStatus);
  }, [append, gradeStatus]);

  useEffect(() => {
    if (!startupTimings) return;
    const timings = formatStartupTimings(startupTimings);
    if (timings) append('info', 'Startup', `Image ready: ${sourceName}`, timings);
    onDocumentReadyRef.current?.();
  }, [append, sourceName, startupTimings]);

  useEffect(() => {
    if (!psdImportInfo) return;
    const inventory = psdImportInfo.inventory;
    append(
      'info',
      'PSD import',
      `Reconstructed ${inventory.layers} layers, ${inventory.groups} groups, `
        + `${inventory.masks} masks, ${inventory.layerStyles} styled layers, `
        + `${inventory.adjustments} adjustment layers and `
        + `${inventory.smartObjects} smart objects.`,
      photoshopCompatibilitySummary
        ? `Compatibility: ${photoshopCompatibilitySummary}.`
        : undefined
    );
    psdImportInfo.warnings.forEach((warning) => {
      append('warning', 'PSD import', warning);
    });
  }, [append, photoshopCompatibilitySummary, psdImportInfo]);

  useEffect(() => {
    if (!psdDifferenceMetrics) return;
    append(
      'info',
      'PSD comparison',
      `${psdDifferenceMetrics.differingPixelPercentage.toFixed(3)}% pixels differ above `
        + `${Math.round(psdDifferenceMetrics.threshold * 255)}/255.`,
      `Mean RGB error ${(psdDifferenceMetrics.meanAbsoluteRgbError * 100).toFixed(3)}%; `
        + `maximum channel error ${(psdDifferenceMetrics.maximumChannelError * 100).toFixed(2)}%; `
        + `${psdDifferenceMetrics.sampledPixels.toLocaleString()} samples `
        + `(stride ${psdDifferenceMetrics.stride}).`
    );
  }, [append, psdDifferenceMetrics]);

  const clear = useCallback(() => setMessages([]), []);

  return {
    messages,
    photoshopCompatibilitySummary,
    append,
    clear
  };
};

