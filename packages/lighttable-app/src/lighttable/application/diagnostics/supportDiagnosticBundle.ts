import type { LightTableReleaseInfo } from '../../../platform/LightTableHost';
import type { TextRenderPresentationSnapshot } from '../rendering/rendererTypes';
import type { LightTableStartupTimings } from '../telemetry/editorTelemetry';
import type { LightTableDebugMessage } from '../../editor/debug/debugLog';
import type { ImageDocument, LayerNode } from '../../editor/document/documentTypes';
import type { LightTableImageMetadata } from '../../types';
import type { SharedWebGpuDiagnosticSnapshot } from '../../gpu/sharedWebGpuDevice';
import type { LocalBetaDiagnosticSnapshot } from './localBetaDiagnostics';

export const SUPPORT_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const SUPPORT_DIAGNOSTIC_MAX_EVENTS = 100;
export const SUPPORT_DIAGNOSTIC_MAX_EVENT_BYTES = 64 * 1024;

export type DiagnosticAvailability<T> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface SupportDiagnosticOptions {
  readonly includeFileName: boolean;
}

export interface SupportDiagnosticInput {
  readonly now?: number;
  readonly hostKind: 'web' | 'electron' | 'storybuilder';
  readonly release: LightTableReleaseInfo | null;
  readonly gpu: SharedWebGpuDiagnosticSnapshot | null;
  readonly metadata: LightTableImageMetadata | null;
  /** Used only to derive media type and, after explicit opt-in, a basename. */
  readonly sourceFileName?: string | null;
  readonly document: ImageDocument | null;
  readonly startupTimings: LightTableStartupTimings | null;
  readonly gpuMemoryBytes: number | null;
  readonly textRender: TextRenderPresentationSnapshot | null;
  readonly events: readonly LightTableDebugMessage[];
  readonly betaDiagnostics?: LocalBetaDiagnosticSnapshot | null;
}

export interface SupportDiagnosticArtifact {
  readonly bundle: Record<string, unknown>;
  readonly json: string;
  readonly summary: string;
  readonly file: File;
  readonly collectionDurationMs: number;
}

const REDACTED_PATH = '[redacted-path]';
const REDACTED_URL = '[redacted-url]';
const REDACTED_SECRET = '[redacted-secret]';
const REDACTED_CONTENT = '[redacted-document-content]';
const MAX_TEXT_LENGTH = 2_048;

const encodeBytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** One redaction boundary used by both JSON and human-readable attachments. */
export const redactDiagnosticText = (
  input: string,
  options: SupportDiagnosticOptions,
  documentName?: string | null,
  documentTexts: readonly string[] = []
): string => {
  let value = input.slice(0, MAX_TEXT_LENGTH);
  for (const text of documentTexts) {
    if (text.length >= 2) value = value.replaceAll(text, REDACTED_CONTENT);
  }
  value = value.replace(/(?:[A-Za-z]:\\|\\\\).*?(?=\s+(?:https?|wss?):\/\/|[\r\n]|$)/gu, REDACTED_PATH);
  value = value.replace(/(?:^|\s)\/(?:Users|home|var|tmp|private|mnt)\/.*?(?=\s+(?:https?|wss?):\/\/|[\r\n]|$)/gu,
    (match) => `${match.startsWith(' ') ? ' ' : ''}${REDACTED_PATH}`);
  value = value.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/giu, REDACTED_URL);
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, `Bearer ${REDACTED_SECRET}`);
  value = value.replace(/\b(?:pairing[\s_-]*(?:code|token)|access[\s_-]*token|api[\s_-]*key)\s*[:=]\s*[^\s,;]+/giu,
    (match) => `${match.split(/[:=]/u, 1)[0]}: ${REDACTED_SECRET}`);
  value = value.replace(/\b(?:mcp[\s_-]*(?:token|data|payload|prompt))\s*[:=]\s*[^\r\n]+/giu,
    (match) => `${match.split(/[:=]/u, 1)[0]}: ${REDACTED_SECRET}`);
  value = value.replace(/\b(?:document[\s_-]*(?:content|text)|text[\s_-]*content)\s*[:=]\s*[^\r\n]+/giu,
    (match) => `${match.split(/[:=]/u, 1)[0]}: ${REDACTED_CONTENT}`);
  value = value.replace(/\bdata:[^;,\s]+;base64,[A-Za-z0-9+/=]+/giu, '[redacted-binary]');
  if (documentName && !options.includeFileName) {
    value = value.replaceAll(documentName, '[redacted-filename]');
  }
  return value;
};

const countLayers = (layers: readonly LayerNode[]): number => layers.reduce(
  (count, layer) => count + 1 + (layer.type === 'group' ? countLayers(layer.children) : 0),
  0
);

const documentTextCanaries = (layers: readonly LayerNode[]): string[] => {
  const texts: string[] = [];
  let retainedCharacters = 0;
  const visit = (nodes: readonly LayerNode[]) => {
    for (const layer of nodes) {
      if (texts.length >= 128 || retainedCharacters >= 32_768) return;
      if (layer.type === 'group') visit(layer.children);
      if (layer.type !== 'text') continue;
      const text = layer.text.source.kind === 'flow'
        ? layer.text.source.text
        : layer.text.source.extractedText;
      if (!text) continue;
      const bounded = text.slice(0, 4_096);
      texts.push(bounded);
      retainedCharacters += bounded.length;
    }
  };
  visit(layers);
  return texts.sort((left, right) => right.length - left.length);
};

const sourceMediaType = (name: string | null | undefined, fallback: string) => {
  const extension = name?.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase();
  if (extension === 'psd' || extension === 'psb') return 'image/vnd.adobe.photoshop';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'avif') return 'image/avif';
  return fallback;
};

const sourceBaseName = (name: string | null | undefined) => name?.split(/[\\/]/u).at(-1) ?? null;

const available = <T,>(value: T): DiagnosticAvailability<T> => ({ status: 'available', value });
const unavailable = <T,>(reason: string): DiagnosticAvailability<T> => ({ status: 'unavailable', reason });

const boundedEvents = (
  events: readonly LightTableDebugMessage[],
  options: SupportDiagnosticOptions,
  documentName?: string | null,
  documentTexts: readonly string[] = []
) => {
  const result: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (const event of events.slice(-SUPPORT_DIAGNOSTIC_MAX_EVENTS).reverse()) {
    const candidate = {
      timestamp: new Date(event.timestamp).toISOString(),
      severity: event.severity,
      source: redactDiagnosticText(event.source, options, documentName, documentTexts),
      message: redactDiagnosticText(event.message, options, documentName, documentTexts),
      ...(event.details ? { details: redactDiagnosticText(event.details, options, documentName, documentTexts) } : {})
    };
    const size = encodeBytes(JSON.stringify(candidate));
    if (bytes + size > SUPPORT_DIAGNOSTIC_MAX_EVENT_BYTES) continue;
    result.push(candidate);
    bytes += size;
  }
  return { entries: result.reverse(), retainedBytes: bytes, omitted: events.length - result.length };
};

export const createSupportDiagnosticArtifact = (
  input: SupportDiagnosticInput,
  options: SupportDiagnosticOptions
): SupportDiagnosticArtifact => {
  const startedAt = performance.now();
  const documentName = sourceBaseName(input.sourceFileName) ?? input.metadata?.name ?? input.document?.name ?? null;
  const documentTexts = input.document ? documentTextCanaries(input.document.layers) : [];
  const events = boundedEvents(input.events, options, documentName, documentTexts);
  const failures = events.entries.filter((event) => event.severity === 'warning' || event.severity === 'error');
  const metadata = input.metadata;
  const document = input.document;
  const baseSummary = redactDiagnosticText([
    `LightTable support diagnostics v${SUPPORT_DIAGNOSTIC_SCHEMA_VERSION}`,
    `Host: ${input.hostKind}`,
    `Document: ${metadata ? `${sourceMediaType(input.sourceFileName, metadata.contentType)}, ${metadata.width} x ${metadata.height}` : document ? `${document.width} x ${document.height}` : 'unavailable'}`,
    `GPU: ${input.gpu ? input.gpu.description || input.gpu.device || 'available' : 'unavailable'}`,
    `Events: ${events.entries.length} retained, ${events.omitted} omitted`,
    ...failures.slice(-3).map((failure) => `Failure: [${failure.source}] ${failure.message}`),
    'Collection source: existing snapshots only; 0 recompositions; 0 readbacks'
  ].join('\n'), options, documentName);
  const bundle: Record<string, unknown> = {
    schema: 'com.lighttable.support-diagnostics',
    schemaVersion: SUPPORT_DIAGNOSTIC_SCHEMA_VERSION,
    validity: { valid: true, bounded: true, redacted: true },
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    privacy: {
      localOnly: true,
      uploaded: false,
      fileNameIncluded: options.includeFileName,
      documentContentIncluded: false,
      binaryPayloadsIncluded: false
    },
    app: input.release ? available(input.release) : unavailable('Release metadata is not exposed by this host.'),
    host: available({
      kind: input.hostKind,
      userAgent: redactDiagnosticText(globalThis.navigator?.userAgent ?? 'unavailable', options)
    }),
    gpu: input.gpu ? available(input.gpu) : unavailable('No initialized WebGPU adapter snapshot is available.'),
    document: metadata || document ? available({
      ...(options.includeFileName && documentName ? { fileName: documentName } : {}),
      type: sourceMediaType(input.sourceFileName, metadata?.sourceFormat ?? metadata?.contentType ?? 'unknown'),
      width: metadata?.width ?? document?.width ?? null,
      height: metadata?.height ?? document?.height ?? null,
      bitDepth: metadata?.sourceBitDepth ?? null,
      colorSpace: document?.colorSettings.workingProfile ?? metadata?.sourceProfile ?? null,
      layerCount: document ? countLayers(document.layers) : null,
      decoder: metadata?.decoder ?? null
    }) : unavailable('No document is open.'),
    timings: input.startupTimings ? available(input.startupTimings) : unavailable('Startup timing samples are unavailable.'),
    resources: {
      gpuTextureBytes: input.gpuMemoryBytes === null ? unavailable('Renderer memory estimate is unavailable.') : available(input.gpuMemoryBytes),
      textTextureBytes: input.textRender ? available(input.textRender.textureBytes) : unavailable('Text renderer snapshot is unavailable.'),
      textLayoutCacheBytes: input.textRender ? available(input.textRender.layoutCacheBytes) : unavailable('Text renderer snapshot is unavailable.'),
      textAtlasBytes: input.textRender ? available(input.textRender.atlasBytes) : unavailable('Text renderer snapshot is unavailable.')
    },
    failures,
    events,
    betaDiagnostics: input.betaDiagnostics?.enabled
      ? available(input.betaDiagnostics)
      : unavailable('Local beta diagnostics are disabled.'),
    attachments: [{
      name: 'summary.txt',
      mediaType: 'text/plain',
      encoding: 'utf-8',
      content: baseSummary
    }],
    collection: {
      source: 'existing-snapshots-only',
      rendererRecompositions: 0,
      gpuReadbacks: 0
    }
  };
  const json = JSON.stringify(bundle, null, 2);
  const duration = performance.now() - startedAt;
  const safeSummary = `${baseSummary}\nCollection cost: ${duration.toFixed(2)} ms`;
  return {
    bundle,
    json,
    summary: safeSummary,
    file: new File([json], `LightTable-diagnostics-${new Date(input.now ?? Date.now()).toISOString().replace(/[:.]/gu, '-')}.json`, {
      type: 'application/json'
    }),
    collectionDurationMs: duration
  };
};
