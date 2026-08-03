import type { PdfSourceDescriptor } from './types';

export interface PdfSourceProbeLimits {
  readonly maximumMarkerScanBytes: number;
}

export const DEFAULT_PDF_SOURCE_PROBE_LIMITS: PdfSourceProbeLimits = Object.freeze({
  maximumMarkerScanBytes: 8 * 1024 * 1024
});

export type PdfSourceProbe =
  | {
    readonly kind: 'pdf' | 'pdf-compatible-ai';
    readonly importable: true;
    readonly pdfVersion: string | null;
    readonly nativeAiData: 'absent' | 'preserved-unsupported';
    readonly evidence: readonly string[];
    readonly requiresOriginalSourcePreservation: true;
  }
  | {
    readonly kind: 'native-ai';
    readonly importable: false;
    readonly pdfVersion: null;
    readonly nativeAiData: 'preserved-unsupported';
    readonly evidence: readonly string[];
    readonly requiresOriginalSourcePreservation: true;
  }
  | {
    readonly kind: 'unsupported';
    readonly importable: false;
    readonly pdfVersion: null;
    readonly nativeAiData: 'absent';
    readonly evidence: readonly string[];
    readonly requiresOriginalSourcePreservation: false;
  };

const ascii = (bytes: Uint8Array, start: number, end: number) => {
  let value = '';
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
};

const boundedSegments = (bytes: Uint8Array, maximumBytes: number) => {
  const bounded = Math.max(0, Math.floor(maximumBytes));
  if (bytes.length <= bounded) return [ascii(bytes, 0, bytes.length)];
  const headLength = Math.ceil(bounded / 2);
  const tailLength = Math.floor(bounded / 2);
  return [
    ascii(bytes, 0, Math.min(bytes.length, headLength)),
    ascii(bytes, Math.max(0, bytes.length - tailLength), bytes.length)
  ];
};

const containsAny = (segments: readonly string[], markers: readonly string[]) =>
  markers.some(marker => segments.some(segment => segment.includes(marker)));

const ILLUSTRATOR_MARKERS = [
  'Adobe Illustrator',
  'Adobe_Illustrator',
  '/Illustrator',
  'illustrator:Type'
] as const;

const PRIVATE_AI_MARKERS = [
  '/AIPrivateData',
  '/AIPDFPrivateData',
  '/PieceInfo<</Illustrator',
  '/PieceInfo << /Illustrator'
] as const;

/**
 * Bounded raw-source classification. This does not parse PDF objects and can
 * only opt into AI handling on explicit extension or Illustrator evidence.
 */
export const probePdfSource = (
  bytes: Uint8Array,
  fileName: string,
  limitOverrides: Partial<PdfSourceProbeLimits> = {}
): PdfSourceProbe => {
  const limits = { ...DEFAULT_PDF_SOURCE_PROBE_LIMITS, ...limitOverrides };
  const header = ascii(bytes, 0, Math.min(bytes.length, 1024));
  const pdfHeader = /%PDF-(\d\.\d)/.exec(header);
  const segments = boundedSegments(bytes, limits.maximumMarkerScanBytes);
  const aiExtension = /\.ai$/i.test(fileName.trim());
  const illustratorEvidence = containsAny(segments, ILLUSTRATOR_MARKERS);
  const privateAiData = containsAny(segments, PRIVATE_AI_MARKERS);

  if (pdfHeader) {
    const compatibleAi = aiExtension || illustratorEvidence || privateAiData;
    return {
      kind: compatibleAi ? 'pdf-compatible-ai' : 'pdf',
      importable: true,
      pdfVersion: pdfHeader[1] ?? null,
      nativeAiData: privateAiData ? 'preserved-unsupported' : 'absent',
      evidence: [
        'pdf-header',
        ...(aiExtension ? ['ai-extension'] : []),
        ...(illustratorEvidence ? ['illustrator-metadata'] : []),
        ...(privateAiData ? ['native-ai-private-data'] : [])
      ],
      requiresOriginalSourcePreservation: true
    };
  }

  const postScript = header.includes('%!PS-Adobe-');
  if (aiExtension) {
    return {
      kind: 'native-ai',
      importable: false,
      pdfVersion: null,
      nativeAiData: 'preserved-unsupported',
      evidence: [
        'ai-extension',
        ...(postScript ? ['postscript-header'] : []),
        ...(illustratorEvidence ? ['illustrator-metadata'] : [])
      ],
      requiresOriginalSourcePreservation: true
    };
  }

  return {
    kind: 'unsupported',
    importable: false,
    pdfVersion: null,
    nativeAiData: 'absent',
    evidence: [],
    requiresOriginalSourcePreservation: false
  };
};

export interface PreservedPdfSourceReference {
  readonly assetId: string;
  readonly byteLength: number;
  readonly fingerprintSha256: string;
}

/** Binds an importable probe to the immutable original-byte asset. */
export const createPdfSourceDescriptor = (
  probe: Extract<PdfSourceProbe, { readonly importable: true }>,
  source: PreservedPdfSourceReference
): PdfSourceDescriptor => ({
  format: probe.kind,
  originalAssetId: source.assetId,
  byteLength: source.byteLength,
  fingerprintSha256: source.fingerprintSha256,
  pdfVersion: probe.pdfVersion,
  nativeAiData: probe.nativeAiData
});
