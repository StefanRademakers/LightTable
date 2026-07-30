import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type {
  PhotoshopImportCompatibilityEntry,
  PhotoshopImportReport,
  PhotoshopImportSupport
} from '../document/documentTypes';
import type { ReferenceDifferenceMetrics } from '../../gpu/WebGpuEngine';

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
  onClose(): void;
}

export const PsdImportReportDialog: React.FC<PsdImportReportDialogProps> = ({
  open,
  report,
  metrics,
  onClose
}) => {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const entries = useMemo(
    () => report?.compatibility.filter((entry) => filter === 'all' || entry.support === filter) ?? [],
    [filter, report]
  );
  if (!open || !report) return null;

  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        className="lighttable-psd-report"
        role="dialog"
        aria-modal="true"
        aria-label="Photoshop import report"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>Photoshop import report</h2>
            <p>Semantic LightTable reconstruction. The embedded composite is reference-only.</p>
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
          {entries.map((entry: PhotoshopImportCompatibilityEntry, index) => (
            <article className="lighttable-psd-report__entry" key={`${entry.path}-${entry.feature}-${index}`}>
              <span className={`lighttable-psd-report__support lighttable-psd-report__support--${entry.support}`}>
                {entry.support}
              </span>
              <div>
                <strong>{entry.path}</strong>
                <small>{entry.feature}</small>
                <p>{entry.reason}</p>
              </div>
            </article>
          ))}
          {!entries.length ? <p className="lighttable-psd-report__empty">No entries in this category.</p> : null}
        </div>
        {report.warnings.length ? (
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
