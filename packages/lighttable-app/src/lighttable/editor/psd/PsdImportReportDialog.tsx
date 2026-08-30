import { Button, SegmentedControl } from '@lighttable/ui';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';

import type {
  DocumentFontAsset,
  LayerId,
  PhotoshopImportCompatibilityEntry,
  PhotoshopImportReport
} from '../document/documentTypes';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { FontAssetPicker } from '../ui/FontAssetPicker';
import {
  buildDocumentCapabilityFindings,
  sanitizeCompatibilityText,
  summarizeDocumentCapabilityFindings,
  type DocumentCapabilityStatus
} from '../compatibility/documentCapabilityFindings';

type ReportFilter = 'all' | DocumentCapabilityStatus;

const FILTERS: Array<{ value: ReportFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'exact', label: 'Exact' },
  { value: 'approximated', label: 'Approx.' },
  { value: 'preview-backed', label: 'Preview' },
  { value: 'missing-asset', label: 'Missing' },
  { value: 'export-blocking', label: 'Export' }
];

interface PsdImportReportDialogProps {
  open: boolean;
  report: PhotoshopImportReport | null;
  metrics: ReferenceDifferenceMetrics | null;
  textFontDiagnostics?: readonly TextFontDiagnostic[];
  replacementFonts?: readonly DocumentFontAsset[];
  onResolveTextFont?(layerId: TextFontDiagnostic['layerId']): void;
  onSelectLayer?(layerId: LayerId): void;
  onReplaceTextFonts?(
    layerIds: readonly LayerId[],
    assetId: string,
    requestedFont: string,
    sourceIdentity: string
  ): void;
  onClose(): void;
}

type DocumentCompatibilityEntry = Omit<PhotoshopImportCompatibilityEntry, 'feature'> & {
  readonly feature: PhotoshopImportCompatibilityEntry['feature'] | 'text-font';
  readonly layerId?: TextFontDiagnostic['layerId'];
  readonly editable?: boolean;
};

export interface MissingFontDiagnosticGroup {
  readonly sourceIdentity: string;
  readonly requestedFont: string;
  readonly layerIds: readonly LayerId[];
  readonly layerNames: readonly string[];
}

export const groupMissingFontDiagnostics = (
  diagnostics: readonly TextFontDiagnostic[]
): MissingFontDiagnosticGroup[] => {
  const groups = new Map<string, {
    requestedFont: string; layerIds: LayerId[]; layerNames: string[]
  }>();
  diagnostics.forEach((diagnostic) => {
    if (diagnostic.issue !== 'font-missing' || !diagnostic.editable) return;
    if (!diagnostic.sourceIdentity) return;
    const requestedFont = diagnostic.requestedFont ?? 'Unknown font';
    const group = groups.get(diagnostic.sourceIdentity) ?? {
      requestedFont, layerIds: [], layerNames: []
    };
    if (!group.layerIds.includes(diagnostic.layerId)) {
      group.layerIds.push(diagnostic.layerId);
      group.layerNames.push(diagnostic.layerName);
    }
    groups.set(diagnostic.sourceIdentity, group);
  });
  return [...groups.entries()]
    .map(([sourceIdentity, group]) => ({ sourceIdentity, ...group }))
    .sort((left, right) => left.requestedFont.localeCompare(right.requestedFont));
};

const fontLabel = (font: DocumentFontAsset) => {
  const family = font.familyNames[0] ?? font.postScriptName ?? 'Unknown';
  return `${family} — ${font.styleName}`;
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
  onSelectLayer,
  onReplaceTextFonts,
  onClose
}) => {
  const dialogOpen = open && Boolean(report || textFontDiagnostics.length);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(dialogOpen, onClose);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const findings = useMemo(
    () => buildDocumentCapabilityFindings(report, textFontDiagnostics),
    [report, textFontDiagnostics]
  );
  const summary = useMemo(() => summarizeDocumentCapabilityFindings(findings), [findings]);
  const entries = useMemo(
    () => findings.filter((entry) => filter === 'all' || entry.status === filter),
    [findings, filter]
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
      missingFontGroups.map(({ sourceIdentity }) => [sourceIdentity, fallback])
    ));
  }, [open, missingFontGroups, sortedReplacementFonts]);
  if (!open || (!report && textFontDiagnostics.length === 0)) return null;
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="lighttable-psd-report"
        role="dialog"
        aria-modal="true"
        aria-label="Document compatibility report"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>Document compatibility report</h2>
            <p>Imported and current compatibility findings. Preserved source data remains unchanged until an explicit destructive action.</p>
          </div>
          <Button tabIndex={0} data-ui-theme="dark" onClick={onClose}>Close</Button>
        </header>
        {metrics ? (
          <div className="lighttable-psd-report__metrics">
            <span>{metrics.differingPixelPercentage.toFixed(3)}% differing</span>
            <span>{(metrics.meanAbsoluteRgbError * 100).toFixed(3)}% mean RGB error</span>
            <span>{(metrics.maximumChannelError * 100).toFixed(2)}% max channel error</span>
            <span>{metrics.sampledPixels.toLocaleString()} samples</span>
          </div>
        ) : null}
        <div className="lighttable-psd-report__summary" aria-label="Compatibility summary">
          <span><strong>{summary.attention}</strong> need attention</span>
          <span><strong>{summary.previewBacked}</strong> preview-backed</span>
          <span><strong>{summary.missingAssets}</strong> missing assets</span>
          <span><strong>{summary.exportBlocking}</strong> block editable export</span>
        </div>
        <SegmentedControl tabIndex={0} data-ui-theme="dark"
          className="lighttable-psd-report__filters"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
          label="Photoshop import support filter"
        />
        {missingFontGroups.length > 0 && onReplaceTextFonts ? (
          <section className="lighttable-psd-report__font-manager" aria-label="Missing fonts">
            <h3>Missing fonts</h3>
            <p>Choose one replacement for every layer that requests the same unavailable font.</p>
            {missingFontGroups.map((group) => (
              <div className="lighttable-psd-report__font-row" key={group.sourceIdentity}>
                <span>
                  <strong>{group.requestedFont}</strong>
                  <small>{group.layerIds.length} {group.layerIds.length === 1 ? 'layer' : 'layers'}</small>
                </span>
                <FontAssetPicker ariaLabel={`Replacement for ${group.requestedFont}`}
                  fonts={sortedReplacementFonts}
                  value={fontReplacements[group.sourceIdentity] ?? ''}
                  onChange={(assetId) => setFontReplacements((current) => ({
                    ...current,
                    [group.sourceIdentity]: assetId
                  }))} />
                <Button tabIndex={0} data-ui-theme="dark"
                  disabled={!fontReplacements[group.sourceIdentity]}
                  onClick={() => onReplaceTextFonts(
                    group.layerIds,
                    fontReplacements[group.sourceIdentity]!,
                    group.requestedFont,
                    group.sourceIdentity
                  )}
                >
                  Replace all
                </Button>
              </div>
            ))}
          </section>
        ) : null}
        <div className="lighttable-psd-report__entries">
          {entries.map((entry, index) => (
            <article className="lighttable-psd-report__entry" key={entry.id}>
              <span className={`lighttable-psd-report__support lighttable-psd-report__support--${entry.status}`}>
                {entry.status}
              </span>
              <div>
                <strong>{entry.layerName}</strong>
                <small>{entry.feature}</small>
                {formatCompatibilityParity(entry.parity) ? (
                  <small>{formatCompatibilityParity(entry.parity)}</small>
                ) : null}
                <p>{entry.message}</p>
                {entry.invalidatedByEdit ? (
                  <p className="lighttable-psd-report__invalidation">
                    Editing this feature discards its retained visual preview. Keep it unchanged or make an explicit raster copy first.
                  </p>
                ) : null}
                <div className="lighttable-psd-report__actions">
                  {entry.layerId && (entry.feature === 'text-font' ? onResolveTextFont : onSelectLayer) ? (
                    <Button tabIndex={0} data-ui-theme="dark" onClick={() => entry.feature === 'text-font'
                      ? onResolveTextFont?.(entry.layerId!)
                      : onSelectLayer?.(entry.layerId!)}>
                      {entry.feature === 'text-font' && entry.editable ? 'Choose font...' : 'Select layer'}
                    </Button>
                  ) : null}
                  {entry.actions.includes('keep-preview') ? (
                    <Button tabIndex={0} data-ui-theme="dark" onClick={onClose}>Keep preview</Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {!entries.length ? <p className="lighttable-psd-report__empty">No entries in this category.</p> : null}
        </div>
        {report?.warnings.length ? (
          <details className="lighttable-psd-report__warnings">
            <summary>Parser and compatibility warnings ({report.warnings.length})</summary>
            <ul>
              {report.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{sanitizeCompatibilityText(warning)}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>,
    document.body
  );
};
