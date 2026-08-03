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
  const [validation, setValidation] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'running' }
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  useEffect(() => {
    generationRef.current += 1;
    setValidation({ kind: 'idle' });
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
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        className="lighttable-psd-report"
        role="dialog"
        aria-modal="true"
        aria-label="PDF export preflight"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>PDF export preflight</h2>
            <p>Text and font planning only. PDF writing is not enabled yet.</p>
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
              This document has no visible text layers. Vector, raster and group PDF writing are not part of this preflight yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
};
