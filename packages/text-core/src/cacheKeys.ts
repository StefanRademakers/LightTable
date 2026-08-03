import type { TextLayerRevisions } from './types';
import type { TextLayoutOptions } from './workerProtocol';

export interface TextLayoutCacheKeyInput {
  readonly documentSessionId: string;
  readonly sessionGeneration: number;
  readonly layerId: string;
  readonly revisions: TextLayerRevisions;
  readonly fontSnapshotRevision: number;
  /** Geometry revision/hash of a referenced path layer, or 0 for non-path text. */
  readonly pathDependencyRevision: number;
  readonly options: TextLayoutOptions;
}

const cacheInteger = (value: number, label: string): string => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
  return String(value);
};

export const createTextLayoutOptionsFingerprint = (options: TextLayoutOptions): string => {
  if (options.quality !== 'interactive' && options.quality !== 'final') {
    throw new RangeError('quality must be interactive or final.');
  }
  if (!Number.isFinite(options.effectiveScale) || options.effectiveScale <= 0) {
    throw new RangeError('effectiveScale must be positive and finite.');
  }
  if (!Number.isSafeInteger(options.maxGlyphCount) || options.maxGlyphCount < 1) {
    throw new RangeError('maxGlyphCount must be a positive safe integer.');
  }
  // Scale selects presentation/raster quality downstream; it must never make
  // identical authored text reshape when the viewport zoom changes.
  return [
    options.quality,
    String(options.maxGlyphCount),
    encodeURIComponent(options.locale?.trim().toLowerCase() ?? '')
  ].join(',');
};

export const createTextLayoutCacheKey = ({
  documentSessionId,
  sessionGeneration,
  layerId,
  revisions,
  fontSnapshotRevision,
  pathDependencyRevision,
  options
}: TextLayoutCacheKeyInput): string => [
  'text-layout-v2',
  encodeURIComponent(documentSessionId),
  cacheInteger(sessionGeneration, 'session generation'),
  encodeURIComponent(layerId),
  cacheInteger(revisions.content, 'content revision'),
  cacheInteger(revisions.font, 'font revision'),
  cacheInteger(revisions.layout, 'layout revision'),
  cacheInteger(revisions.path, 'path revision'),
  cacheInteger(revisions.geometry, 'geometry revision'),
  cacheInteger(fontSnapshotRevision, 'font snapshot revision'),
  cacheInteger(pathDependencyRevision, 'path dependency revision'),
  createTextLayoutOptionsFingerprint(options)
].join(':');

export type TextRevisionDomain = keyof TextLayerRevisions;

export const bumpTextLayerRevision = (
  revisions: TextLayerRevisions,
  domain: TextRevisionDomain
): TextLayerRevisions => {
  if (!Number.isSafeInteger(revisions[domain]) || revisions[domain] < 0 || revisions[domain] === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${domain} revision cannot be incremented safely.`);
  }
  return { ...revisions, [domain]: revisions[domain] + 1 };
};
