import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type {
  DocumentFontAsset,
  LayerId,
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
  replacementFonts?: readonly DocumentFontAsset[];
  onResolveTextFont?(layerId: TextFontDiagnostic['layerId']): void;
  onReplaceTextFonts?(
    layerIds: readonly LayerId[],
    assetId: string,
    requestedFont: string
  ): void;
  onClose(): void;
}

type DocumentCompatibilityEntry = Omit<PhotoshopImportCompatibilityEntry, 'feature'> & {
  readonly feature: PhotoshopImportCompatibilityEntry['feature'] | 'text-font';
  readonly layerId?: TextFontDiagnostic['layerId'];
  readonly editable?: boolean;
};

export interface MissingFontDiagnosticGroup {
  readonly requestedFont: string;
  readonly layerIds: readonly LayerId[];
  readonly layerNames: readonly string[];
}

export const groupMissingFontDiagnostics = (
  diagnostics: readonly TextFontDiagnostic[]
): MissingFontDiagnosticGroup[] => {
  const groups = new Map<string, { layerIds: LayerId[]; layerNames: string[] }>();
  diagnostics.forEach((diagnostic) => {
    if (diagnostic.issue !== 'font-missing' || !diagnostic.editable) return;
    const requestedFont = diagnostic.requestedFont ?? 'Unknown font';
    const group = groups.get(requestedFont) ?? { layerIds: [], layerNames: [] };
    if (!group.layerIds.includes(diagnostic.layerId)) {
      group.layerIds.push(diagnostic.layerId);
      group.layerNames.push(diagnostic.layerName);
    }
    groups.set(requestedFont, group);
  });
  return [...groups.entries()]
    .map(([requestedFont, group]) => ({ requestedFont, ...group }))
    .sort((left, right) => left.requestedFont.localeCompare(right.requestedFont));
};

const fontLabel = (font: DocumentFontAsset) => {
  const family = font.familyNames[0] ?? font.postScriptName ?? 'Unknown';
  return `${family} â€” ${font.styleName}`;
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
  replacementFonts = [],
  onResolveTextFont,
  onReplaceTextFonts,
  onClose
}) => {
  const dialogOpen = open && Boolean(report || textFontDiagnostics.length);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(dialogOpen, onClose);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const compatibility = useMemo(
    () => buildDocumentCompatibilityEntries(report, textFontDiagnostics),
    [report, textFontDiagnostics]
  );
  const entries = useMemo(
    () => compatibility.filter((entry) => filter === 'all' || entry.support === filter),
    [compatibility, filter]
  );
  const missingFontGroups = useMemo(
    () => groupMissingFontDiagnostics(textFontDiagnostics),
    [textFontDiagnostics]
  );
  const sortedReplacementFonts = useMemo(
    () => [...replacementFonts].sort((left, right) =>
      fontLabel(left).localeCompare(fontLabel(right))),
    [replacementFonts]
  );
  const [fontReplacements, setFontReplacements] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setFilter('all');
    const fallback = sortedReplacementFonts[0]?.assetId ?? '';
    setFontReplacements(Object.fromEntries(
      missingFontGroups.map(({ requestedFont }) => [requestedFont, fallback])
    ));
  }, [open, missingFontGroups, sortedReplacementFonts]);
  if (!open || (!report && textFontDiagnostics.length === 0)) return null;
  const documentReport = textFontDiagnostics.length > 0;

  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="lighttable-psd-report"
        role="dialog"
        aria-modal="true"
        aria-label={documentReport ? 'Document compatibility report' : 'Photoshop import report'}
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
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
        {missingFontGroups.length > 0 && onReplaceTextFonts ? (
          <section className="lighttable-psd-report__font-manager" aria-label="Missing fonts">
            <h3>Missing fonts</h3>
            <p>Choose one replacement for every layer that requests the same unavailable font.</p>
            {missingFontGroups.map((group) => (
              <div className="lighttable-psd-report__font-row" key={group.requestedFont}>
                <span>
                  <strong>{group.requestedFont}</strong>
                  <small>{group.layerIds.length} {group.layerIds.length === 1 ? 'layer' : 'layers'}</small>
                </span>
                <select
                  aria-label={`Replacement for ${group.requestedFont}`}
                  value={fontReplacements[group.requestedFont] ?? ''}
                  onChange={(event) => setFontReplacements((current) => ({
                    ...current,
                    [group.requestedFont]: event.currentTarget.value
                  }))}
                >
                  {sortedReplacementFonts.map((font) => (
                    <option key={font.assetId} value={font.assetId}>{fontLabel(font)}</option>
                  ))}
                </select>
                <ActionButton
                  disabled={!fontReplacements[group.requestedFont]}
                  onClick={() => onReplaceTextFonts(
                    group.layerIds,
                    fontReplacements[group.requestedFont]!,
                    group.requestedFont
                  )}
                >
                  Replace all
                </ActionButton>
              </div>
            ))}
          </section>
        ) : null}
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
