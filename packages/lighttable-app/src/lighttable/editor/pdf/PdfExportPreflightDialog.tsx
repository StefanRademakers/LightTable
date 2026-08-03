import React from 'react';
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
}

interface PdfExportPreflightDialogProps {
  readonly open: boolean;
  readonly request: PdfExportPreflightRequest | null;
  readonly onClose: () => void;
}

const reasons = (messages: readonly { readonly message: string }[]) =>
  messages.map(({ message }) => message).join(' ');

export const PdfExportPreflightDialog: React.FC<PdfExportPreflightDialogProps> = ({
  open,
  request,
  onClose
}) => {
  if (!open || !request) return null;
  const { plan, fontLabels } = request;
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
