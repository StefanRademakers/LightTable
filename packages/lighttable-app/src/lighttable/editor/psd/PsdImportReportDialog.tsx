import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type {
  PhotoshopImportCompatibilityEntry,
  PhotoshopImportReport,
  PhotoshopImportSupport
} from '../document/documentTypes';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';

type ReportFilter = 'all' | PhotoshopImportSupport;

const FILTERS: Array<{ value: ReportFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'native', label: 'Native' },
  { value: 'approximate', label: 'Approx.' },
  { value: 'preserved', label: 'Preserved' },
  { value: 'raster-preview', label: 'Preview' },
  { value: 'placeholder', label: 'Missing' }
];

interface PsdImportReportDialogProps {
  open: boolean;
  report: PhotoshopImportReport | null;
  metrics: ReferenceDifferenceMetrics | null;
  textFontDiagnostics?: readonly TextFontDiagnostic[];
  onResolveTextFont?(layerId: TextFontDiagnostic['layerId']): void;
  onClose(): void;
}

type DocumentCompatibilityEntry = Omit<PhotoshopImportCompatibilityEntry, 'feature'> & {
  readonly feature: PhotoshopImportCompatibilityEntry['feature'] | 'text-font';
  readonly layerId?: TextFontDiagnostic['layerId'];
  readonly editable?: boolean;
};

export const formatCompatibilityParity = (
  parity: PhotoshopImportCompatibilityEntry['parity']
) => parity
  ? `Visual: ${parity.visual} · Semantic: ${parity.semantic} · Structural: ${parity.structural} · Round-trip: ${parity.roundTrip}`
  : null;

export const buildDocumentCompatibilityEntries = (
  report: PhotoshopImportReport | null,
  textFontDiagnostics: readonly TextFontDiagnostic[]
): DocumentCompatibilityEntry[] => [
  ...(report?.compatibility ?? []),
  ...textFontDiagnostics.map(({ layerId, layerName, editable, status }) => ({
    path: layerName,
    feature: 'text-font' as const,
    support: status.kind === 'missing' ? 'placeholder' as const : 'approximate' as const,
    reason: status.detail,
    layerId,
    editable
  }))
];

export const PsdImportReportDialog: React.FC<PsdImportReportDialogProps> = ({
  open,
  report,
  metrics,
  textFontDiagnostics = [],
  onResolveTextFont,
  onClose
}) => {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const compatibility = useMemo(
    () => buildDocumentCompatibilityEntries(report, textFontDiagnostics),
    [report, textFontDiagnostics]
  );
  const entries = useMemo(
    () => compatibility.filter((entry) => filter === 'all' || entry.support === filter),
    [compatibility, filter]
  );
  useEffect(() => {
    if (open) setFilter('all');
  }, [open]);
  if (!open || (!report && textFontDiagnostics.length === 0)) return null;
  const documentReport = textFontDiagnostics.length > 0;

  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        className="lighttable-psd-report"
        role="dialog"
        aria-modal="true"
        aria-label={documentReport ? 'Document compatibility report' : 'Photoshop import report'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>{documentReport ? 'Document compatibility report' : 'Photoshop import report'}</h2>
            <p>{report
              ? 'Semantic LightTable reconstruction. The embedded composite is reference-only.'
              : 'Native document features that need attention.'}</p>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </header>
        {metrics ? (
          <div className="lighttable-psd-report__metrics">
            <span>{metrics.differingPixelPercentage.toFixed(3)}% differing</span>
            <span>{(metrics.meanAbsoluteRgbError * 100).toFixed(3)}% mean RGB error</span>
            <span>{(metrics.maximumChannelError * 100).toFixed(2)}% max channel error</span>
            <span>{metrics.sampledPixels.toLocaleString()} samples</span>
          </div>
        ) : null}
        <SegmentedControl
          className="lighttable-psd-report__filters"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
          ariaLabel="Photoshop import support filter"
        />
        <div className="lighttable-psd-report__entries">
          {entries.map((entry: DocumentCompatibilityEntry, index) => (
            <article className="lighttable-psd-report__entry" key={`${entry.path}-${entry.feature}-${index}`}>
              <span className={`lighttable-psd-report__support lighttable-psd-report__support--${entry.support}`}>
                {entry.support}
              </span>
              <div>
                <strong>{entry.path}</strong>
                <small>{entry.feature}</small>
                {formatCompatibilityParity(entry.parity) ? (
                  <small>{formatCompatibilityParity(entry.parity)}</small>
                ) : null}
                <p>{entry.reason}</p>
                {entry.layerId && onResolveTextFont ? (
                  <ActionButton onClick={() => onResolveTextFont(entry.layerId!)}>
                    {entry.editable ? 'Choose font...' : 'Select layer'}
                  </ActionButton>
                ) : null}
              </div>
            </article>
          ))}
          {!entries.length ? <p className="lighttable-psd-report__empty">No entries in this category.</p> : null}
        </div>
        {report?.warnings.length ? (
          <details className="lighttable-psd-report__warnings">
            <summary>Parser and compatibility warnings ({report.warnings.length})</summary>
            <ul>
              {report.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          </details>
        ) : null}
      </section>
    </div>,
    document.body
  );
};
