import type {
  LayerId,
  PhotoshopImportCompatibilityEntry,
  PhotoshopImportReport
} from '../document/documentTypes';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';

export type DocumentCapabilityStatus =
  | 'exact'
  | 'approximated'
  | 'preview-backed'
  | 'missing-asset'
  | 'export-blocking';

export type DocumentCapabilitySeverity = 'info' | 'warning' | 'error';
export type DocumentRecoveryAction =
  | 'keep-preview'
  | 'replace-font'
  | 'rasterize-copy'
  | 'remove-effect'
  | 'cancel-export'
  | 'export-flattened';

export interface DocumentCapabilityFinding {
  readonly id: string;
  readonly layerId?: LayerId;
  readonly layerName: string;
  readonly feature: PhotoshopImportCompatibilityEntry['feature'] | 'text-font';
  readonly parity?: PhotoshopImportCompatibilityEntry['parity'];
  readonly status: DocumentCapabilityStatus;
  readonly severity: DocumentCapabilitySeverity;
  readonly message: string;
  readonly editable: boolean;
  readonly invalidatedByEdit: boolean;
  readonly actions: readonly DocumentRecoveryAction[];
}

const absoluteWindowsPath = /(?:[A-Za-z]:\\|\\\\)[^\r\n,;]+/g;
const absoluteUrlOrUnixPath = /(?:file:\/\/\/|\/(?:Users|home|var|tmp)\/)[^\s,;]+/g;

const safeBasename = (value: string) => value
  .replaceAll('\\', '/')
  .split('/')
  .at(-1) ?? 'local file';

export const sanitizeCompatibilityText = (value: string): string => {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(absoluteWindowsPath, (match) => safeBasename(match))
    .replace(absoluteUrlOrUnixPath, (match) => safeBasename(match));
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}…`;
};

const sourceStatus = (
  entry: PhotoshopImportCompatibilityEntry
): DocumentCapabilityStatus => {
  if (entry.parity?.roundTrip === 'unsupported') return 'export-blocking';
  switch (entry.support) {
    case 'native': return 'exact';
    case 'approximate': return 'approximated';
    case 'preserved':
    case 'raster-preview': return 'preview-backed';
    case 'placeholder': return 'missing-asset';
  }
};

const recoveryActions = (
  status: DocumentCapabilityStatus,
  feature: DocumentCapabilityFinding['feature']
): readonly DocumentRecoveryAction[] => {
  if (status === 'exact') return [];
  if (status === 'missing-asset' && feature === 'text-font') return ['replace-font', 'keep-preview'];
  if (status === 'export-blocking') return ['cancel-export', 'export-flattened'];
  if (status === 'preview-backed' && feature === 'layer-style') {
    return ['keep-preview', 'remove-effect', 'rasterize-copy'];
  }
  if (status === 'preview-backed') return ['keep-preview', 'rasterize-copy'];
  return [];
};

const severityFor = (status: DocumentCapabilityStatus): DocumentCapabilitySeverity =>
  status === 'exact' ? 'info'
    : status === 'approximated' || status === 'preview-backed' ? 'warning'
      : 'error';

export const buildDocumentCapabilityFindings = (
  report: PhotoshopImportReport | null,
  fontDiagnostics: readonly TextFontDiagnostic[]
): DocumentCapabilityFinding[] => {
  const imported = (report?.compatibility ?? []).map((entry, index) => {
    const status = sourceStatus(entry);
    return {
      id: `import:${entry.layerId ?? entry.path}:${entry.feature}:${index}`,
      layerId: entry.layerId,
      layerName: sanitizeCompatibilityText(entry.path),
      feature: entry.feature,
      parity: entry.parity,
      status,
      severity: severityFor(status),
      message: sanitizeCompatibilityText(entry.reason),
      editable: entry.editable ?? entry.parity?.semantic === 'editable',
      invalidatedByEdit: status === 'preview-backed' || status === 'export-blocking',
      actions: recoveryActions(status, entry.feature)
    } satisfies DocumentCapabilityFinding;
  });
  const fonts = fontDiagnostics.map((diagnostic) => {
    const status: DocumentCapabilityStatus = diagnostic.status.kind === 'missing'
      ? 'missing-asset' : 'approximated';
    return {
      id: `font:${diagnostic.layerId}:${diagnostic.sourceIdentity ?? diagnostic.requestedFont ?? ''}`,
      layerId: diagnostic.layerId,
      layerName: sanitizeCompatibilityText(diagnostic.layerName),
      feature: 'text-font' as const,
      status,
      severity: severityFor(status),
      message: sanitizeCompatibilityText(diagnostic.status.detail),
      editable: diagnostic.editable,
      invalidatedByEdit: false,
      actions: recoveryActions(status, 'text-font')
    } satisfies DocumentCapabilityFinding;
  });
  return [...imported, ...fonts];
};

export const summarizeDocumentCapabilityFindings = (
  findings: readonly DocumentCapabilityFinding[]
) => ({
  exact: findings.filter(({ status }) => status === 'exact').length,
  approximated: findings.filter(({ status }) => status === 'approximated').length,
  previewBacked: findings.filter(({ status }) => status === 'preview-backed').length,
  missingAssets: findings.filter(({ status }) => status === 'missing-asset').length,
  exportBlocking: findings.filter(({ status }) => status === 'export-blocking').length,
  attention: findings.filter(({ status }) => status !== 'exact').length
});

const layerStatusPriority: readonly DocumentCapabilityStatus[] = [
  'export-blocking', 'missing-asset', 'preview-backed', 'approximated'
];

export const primaryLayerCapabilityFinding = (
  findings: readonly DocumentCapabilityFinding[],
  layerId: LayerId
) => layerStatusPriority
  .map((status) => findings.find((finding) => finding.layerId === layerId && finding.status === status))
  .find((finding): finding is DocumentCapabilityFinding => Boolean(finding)) ?? null;
