import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  PdfExportFontDisposition,
  PdfExportTextLayerDisposition,
  PdfTextExportPlan
} from '@lighttable/pdf-core';
import { ActionButton } from '../../../ui/ActionButton';

type ReportSupport = 'native' | 'approximate' | 'raster-preview' | 'placeholder';

export const pdfExportSupportForDisposition = (
  disposition: PdfExportFontDisposition | PdfExportTextLayerDisposition
): ReportSupport => {
  if (disposition === 'blocked') return 'placeholder';
  if (disposition === 'raster') return 'raster-preview';
  if (disposition === 'outline' || disposition === 'mixed') return 'approximate';
  return 'native';
};

export interface PdfExportPreflightRequest {
  readonly plan: PdfTextExportPlan;
  readonly fontLabels: Readonly<Record<string, string>>;
  readonly validateFonts?: () => Promise<{
    readonly embeddedFontCount: number;
    readonly totalEmbeddedBytes: number;
  }>;
  readonly exportFlattenedPage?: () => Promise<{
    readonly byteLength: number;
  }>;
  readonly exportNativeTextPage?: () => Promise<{
    readonly byteLength: number;
    readonly searchableLayerCount: number;
  }>;
  readonly nativeTextUnavailableReason?: string;
  readonly nativeVectorLayerCount?: number;
  readonly exportNativeVectorPage?: () => Promise<{
    readonly byteLength: number;
    readonly vectorLayerCount: number;
  }>;
  readonly nativeVectorUnavailableReason?: string;
  readonly nativeMixedLayerCount?: number;
  readonly exportNativeMixedPage?: () => Promise<{
    readonly byteLength: number;
    readonly searchableLayerCount: number;
    readonly vectorLayerCount: number;
  }>;
  readonly nativeMixedUnavailableReason?: string;
}

interface PdfExportPreflightDialogProps {
  readonly open: boolean;
  readonly request: PdfExportPreflightRequest | null;
  readonly onClose: () => void;
}

const reasons = (messages: readonly { readonly message: string }[]) =>
  messages.map(({ message }) => message).join(' ');

export const formatPdfFontBytes = (byteLength: number) => byteLength < 1024
  ? `${byteLength} B`
  : `${(byteLength / 1024).toFixed(byteLength < 10 * 1024 ? 1 : 0)} KiB`;

export const PdfExportPreflightDialog: React.FC<PdfExportPreflightDialogProps> = ({
  open,
  request,
  onClose
}) => {
  const generationRef = useRef(0);
  const pageExportGenerationRef = useRef(0);
  const nativeExportGenerationRef = useRef(0);
  const vectorExportGenerationRef = useRef(0);
  const mixedExportGenerationRef = useRef(0);
  const [validation, setValidation] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  const [pageExport, setPageExport] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  const [nativeExport, setNativeExport] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  const [vectorExport, setVectorExport] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  const [mixedExport, setMixedExport] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  useEffect(() => {
    generationRef.current += 1;
    pageExportGenerationRef.current += 1;
    nativeExportGenerationRef.current += 1;
    vectorExportGenerationRef.current += 1;
    mixedExportGenerationRef.current += 1;
    setValidation({ kind: 'idle' });
    setPageExport({ kind: 'idle' });
    setNativeExport({ kind: 'idle' });
    setVectorExport({ kind: 'idle' });
    setMixedExport({ kind: 'idle' });
  }, [request]);
  if (!open || !request) return null;
  const { plan, fontLabels } = request;
  const validateFonts = async () => {
    if (!request.validateFonts || validation.kind === 'running') return;
    const generation = ++generationRef.current;
    setValidation({ kind: 'running' });
    try {
      const result = await request.validateFonts();
      if (generation !== generationRef.current) return;
      setValidation({
        kind: 'ready',
        message: `${result.embeddedFontCount} font resource${result.embeddedFontCount === 1 ? '' : 's'} ready · ${formatPdfFontBytes(result.totalEmbeddedBytes)}`
      });
    } catch (error) {
      if (generation !== generationRef.current) return;
      setValidation({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Font validation failed.'
      });
    }
  };
  const exportFlattenedPage = async () => {
    if (!request.exportFlattenedPage || pageExport.kind === 'running') return;
    const generation = ++pageExportGenerationRef.current;
    setPageExport({ kind: 'running' });
    try {
      const result = await request.exportFlattenedPage();
      if (generation !== pageExportGenerationRef.current) return;
      setPageExport({
        kind: 'ready',
        message: `Flattened PDF ready · ${formatPdfFontBytes(result.byteLength)}`
      });
    } catch (error) {
      if (generation !== pageExportGenerationRef.current) return;
      setPageExport({
        kind: 'error',
        message: error instanceof Error ? error.message : 'PDF page export failed.'
      });
    }
  };
  const exportNativeTextPage = async () => {
    if (!request.exportNativeTextPage || nativeExport.kind === 'running') return;
    const generation = ++nativeExportGenerationRef.current;
    setNativeExport({ kind: 'running' });
    try {
      const result = await request.exportNativeTextPage();
      if (generation !== nativeExportGenerationRef.current) return;
      setNativeExport({
        kind: 'ready',
        message: `Native PDF ready · ${result.searchableLayerCount} searchable layer${result.searchableLayerCount === 1 ? '' : 's'} · ${formatPdfFontBytes(result.byteLength)}`
      });
    } catch (error) {
      if (generation !== nativeExportGenerationRef.current) return;
      setNativeExport({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Native PDF export failed.'
      });
    }
  };
  const exportNativeVectorPage = async () => {
    if (!request.exportNativeVectorPage || vectorExport.kind === 'running') return;
    const generation = ++vectorExportGenerationRef.current;
    setVectorExport({ kind: 'running' });
    try {
      const result = await request.exportNativeVectorPage();
      if (generation !== vectorExportGenerationRef.current) return;
      setVectorExport({
        kind: 'ready',
        message: `Native vector PDF ready - ${result.vectorLayerCount} vector layer${result.vectorLayerCount === 1 ? '' : 's'} - ${formatPdfFontBytes(result.byteLength)}`
      });
    } catch (error) {
      if (generation !== vectorExportGenerationRef.current) return;
      setVectorExport({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Native vector PDF export failed.'
      });
    }
  };
  const exportNativeMixedPage = async () => {
    if (!request.exportNativeMixedPage || mixedExport.kind === 'running') return;
    const generation = ++mixedExportGenerationRef.current;
    setMixedExport({ kind: 'running' });
    try {
      const result = await request.exportNativeMixedPage();
      if (generation !== mixedExportGenerationRef.current) return;
      setMixedExport({
        kind: 'ready',
        message: `Native mixed PDF ready - ${result.searchableLayerCount} searchable text layer${result.searchableLayerCount === 1 ? '' : 's'} - ${result.vectorLayerCount} vector layer${result.vectorLayerCount === 1 ? '' : 's'} - ${formatPdfFontBytes(result.byteLength)}`
      });
    } catch (error) {
      if (generation !== mixedExportGenerationRef.current) return;
      setMixedExport({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Native mixed PDF export failed.'
      });
    }
  };
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        className="lighttable-psd-report lighttable-psd-report--pdf"
        role="dialog"
        aria-modal="true"
        aria-label="PDF export preflight"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>PDF export preflight</h2>
            <p>Export a flattened page, native searchable text or native vectors when the page stack is compatible.</p>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </header>
        <div className="lighttable-psd-report__metrics">
          <span>{plan.layers.length} text layer{plan.layers.length === 1 ? '' : 's'}</span>
          <span>{plan.summary.subset} subset</span>
          <span>{plan.summary['embed-existing'] + plan.summary['embed-full']} embedded</span>
          <span>{plan.summary.outline} outlined</span>
          <span>{plan.summary.raster} rasterized</span>
          <span>{plan.summary.blocked} blocked</span>
        </div>
        {request.validateFonts ? (
          <div className="lighttable-psd-report__metrics">
            <ActionButton
              disabled={validation.kind === 'running'}
              onClick={() => { void validateFonts(); }}
            >
              {validation.kind === 'running' ? 'Validating fonts…' : 'Validate font resources'}
            </ActionButton>
            {validation.kind !== 'idle' && validation.kind !== 'running' ? (
              <span role="status">{validation.message}</span>
            ) : null}
          </div>
        ) : null}
        {request.exportFlattenedPage ? (
          <div className="lighttable-psd-report__metrics">
            <ActionButton
              disabled={pageExport.kind === 'running'}
              onClick={() => { void exportFlattenedPage(); }}
            >
              {pageExport.kind === 'running' ? 'Exporting flattened PDF…' : 'Export flattened PDF…'}
            </ActionButton>
            {pageExport.kind !== 'idle' && pageExport.kind !== 'running' ? (
              <span role="status">{pageExport.message}</span>
            ) : null}
          </div>
        ) : null}
        {request.exportNativeTextPage ? (
          <div className="lighttable-psd-report__metrics">
            <ActionButton
              disabled={nativeExport.kind === 'running'}
              onClick={() => { void exportNativeTextPage(); }}
            >
              {nativeExport.kind === 'running' ? 'Exporting native PDF…' : 'Export native text PDF…'}
            </ActionButton>
            {nativeExport.kind !== 'idle' && nativeExport.kind !== 'running' ? (
              <span role="status">{nativeExport.message}</span>
            ) : null}
          </div>
        ) : request.nativeTextUnavailableReason ? (
          <div className="lighttable-psd-report__metrics">
            <span>Native text export unavailable · {request.nativeTextUnavailableReason}</span>
          </div>
        ) : null}
        {request.exportNativeVectorPage ? (
          <div className="lighttable-psd-report__metrics">
            <ActionButton
              disabled={vectorExport.kind === 'running'}
              onClick={() => { void exportNativeVectorPage(); }}
            >
              {vectorExport.kind === 'running' ? 'Exporting native vectors...' : 'Export native vectors PDF...'}
            </ActionButton>
            {vectorExport.kind !== 'idle' && vectorExport.kind !== 'running' ? (
              <span role="status">{vectorExport.message}</span>
            ) : null}
          </div>
        ) : request.nativeVectorUnavailableReason ? (
          <div className="lighttable-psd-report__metrics">
            <span>Native vector export unavailable - {request.nativeVectorUnavailableReason}</span>
          </div>
        ) : null}
        {request.exportNativeMixedPage ? (
          <div className="lighttable-psd-report__metrics">
            <ActionButton
              disabled={mixedExport.kind === 'running'}
              onClick={() => { void exportNativeMixedPage(); }}
            >
              {mixedExport.kind === 'running' ? 'Exporting native text and vectors...' : 'Export native text + vectors PDF...'}
            </ActionButton>
            {mixedExport.kind !== 'idle' && mixedExport.kind !== 'running' ? (
              <span role="status">{mixedExport.message}</span>
            ) : null}
          </div>
        ) : request.nativeMixedUnavailableReason ? (
          <div className="lighttable-psd-report__metrics">
            <span>Combined native export unavailable - {request.nativeMixedUnavailableReason}</span>
          </div>
        ) : null}
        <div className="lighttable-psd-report__entries">
          {plan.fonts.map((font) => (
            <article className="lighttable-psd-report__entry" key={font.instanceId}>
              <span className={`lighttable-psd-report__support lighttable-psd-report__support--${pdfExportSupportForDisposition(font.disposition)}`}>
                {font.disposition}
              </span>
              <div>
                <strong>{fontLabels[font.assetId] ?? font.assetId}</strong>
                <small>font · {font.glyphIds.length} glyphs</small>
                {font.reasons.length > 0 ? <p>{reasons(font.reasons)}</p> : null}
              </div>
            </article>
          ))}
          {plan.layers.map((layer) => (
            <article className="lighttable-psd-report__entry" key={layer.layerId}>
              <span className={`lighttable-psd-report__support lighttable-psd-report__support--${pdfExportSupportForDisposition(layer.disposition)}`}>
                {layer.disposition}
              </span>
              <div>
                <strong>{layer.name}</strong>
                <small>{layer.sourceKind} text · {layer.searchable ? 'searchable' : 'not searchable'}</small>
                {layer.reasons.length > 0 ? <p>{reasons(layer.reasons)}</p> : null}
              </div>
            </article>
          ))}
          {plan.fonts.length === 0 && plan.layers.length === 0 ? (
            <p className="lighttable-psd-report__empty">
              This document has no visible text layers. {request.nativeVectorLayerCount ?? 0} vector layer{request.nativeVectorLayerCount === 1 ? '' : 's'} can be emitted natively when the stack is compatible.
            </p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
};
