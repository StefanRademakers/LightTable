import {
  TEXT_WORKER_PROTOCOL_VERSION,
  type FontAssetRef,
  type Matrix3,
  type RealizedTextLayout,
  type TextLayerData,
  type TextLayoutError
} from './types';

export interface TextLayoutOptions {
  readonly quality: 'interactive' | 'final';
  readonly effectiveScale: number;
  readonly maxGlyphCount: number;
  readonly locale?: string;
}

export interface TextWorkerPerformanceMetrics {
  /** Synchronous font registration or layout work inside the persistent worker. */
  readonly operationDurationMs: number;
  /** Reserved WebAssembly linear memory after the operation, not process RSS. */
  readonly wasmLinearMemoryBytes: number;
}

interface TextWorkerMessageIdentity {
  readonly protocolVersion: typeof TEXT_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly documentSessionId: string;
  readonly sessionGeneration: number;
}

export interface TextWorkerFontRegistrationRequest extends TextWorkerMessageIdentity {
  readonly kind: 'register-font';
  readonly font: FontAssetRef;
  readonly fontSnapshotRevision: number;
  /** Dedicated, full-span JS-owned storage. Ownership moves to the worker. */
  readonly bytes?: Uint8Array;
  readonly byteSource: 'transferred' | 'registered-fingerprint';
  readonly transferOwnership?: 'dedicated';
}

export interface TextLayoutWorkerRequest extends TextWorkerMessageIdentity {
  readonly kind: 'realize-text';
  readonly layerId: string;
  readonly layer: TextLayerData;
  readonly localToDocument: Matrix3;
  readonly fontSnapshotRevision: number;
  readonly pathDependencyRevision: number;
  readonly cacheKey: string;
  readonly options: TextLayoutOptions;
}

export interface TextWorkerGlyphRasterRequest extends TextWorkerMessageIdentity {
  readonly kind: 'rasterize-glyph';
  readonly assetId: string;
  readonly faceIndex: number;
  readonly glyphId: number;
  readonly ppem: number;
  readonly fontSnapshotRevision: number;
}

export interface TextWorkerGlyphRasterResult {
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
  readonly commandCount: number;
  readonly pixels: Uint8Array;
}

/** Logical cancellation: clients reject immediately; synchronous shaping may finish and is ignored. */
export interface TextWorkerCancelRequest extends TextWorkerMessageIdentity {
  readonly kind: 'cancel-text';
  readonly targetRequestId: number;
}

/** Releases every font and layout cache owned by this exact session generation. */
export interface TextWorkerReleaseSessionRequest extends TextWorkerMessageIdentity {
  readonly kind: 'release-session';
}

export type TextWorkerRequest =
  | TextWorkerFontRegistrationRequest
  | TextLayoutWorkerRequest
  | TextWorkerGlyphRasterRequest
  | TextWorkerCancelRequest
  | TextWorkerReleaseSessionRequest;

interface TextWorkerResponseIdentity extends TextWorkerMessageIdentity {
  readonly cacheKey?: string;
}

export type TextLayoutWorkerResponse =
  | TextWorkerResponseIdentity & {
    readonly kind: 'glyph-rasterized';
    readonly assetId: string;
    readonly faceIndex: number;
    readonly glyphId: number;
    readonly ppem: number;
    readonly fontSnapshotRevision: number;
    readonly raster: TextWorkerGlyphRasterResult;
    readonly transferOwnership: 'dedicated';
    readonly metrics: TextWorkerPerformanceMetrics;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'glyph-rasterization-failed';
    readonly assetId: string;
    readonly glyphId: number;
    readonly error: TextLayoutError;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'font-registered';
    readonly assetId: string;
    readonly fontSnapshotRevision: number;
    readonly metrics: TextWorkerPerformanceMetrics;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'text-realized';
    readonly cacheKey: string;
    readonly layout: RealizedTextLayout;
    /** Every typed table owns a distinct, full-span JS ArrayBuffer. */
    readonly transferOwnership: 'dedicated';
    readonly metrics: TextWorkerPerformanceMetrics;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'text-layout-failed';
    readonly cacheKey: string;
    readonly error: TextLayoutError;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'font-registration-failed';
    readonly assetId: string;
    readonly error: TextLayoutError;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'session-released';
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'session-release-failed';
    readonly error: TextLayoutError;
  };

export class TextTransferContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextTransferContractError';
  }
}

const appendDedicatedBuffer = (
  buffers: ArrayBuffer[],
  view: ArrayBufferView,
  label: string
): void => {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new TextTransferContractError(`${label} must use a transferable ArrayBuffer.`);
  }
  if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
    throw new TextTransferContractError(`${label} must own a dedicated full-span ArrayBuffer.`);
  }
  if (buffers.includes(view.buffer)) {
    throw new TextTransferContractError(`${label} shares storage with another transferable table.`);
  }
  buffers.push(view.buffer);
};

export const copyFontBytesToDedicatedStorage = (bytes: Uint8Array): Uint8Array => {
  const dedicated = new Uint8Array(bytes.byteLength);
  dedicated.set(bytes);
  return dedicated;
};

export const collectTextRequestTransferBuffers = (
  request: TextWorkerRequest
): readonly ArrayBuffer[] => {
  if (request.kind !== 'register-font') return [];
  if (request.byteSource === 'registered-fingerprint') return [];
  if (!request.bytes || request.transferOwnership !== 'dedicated') {
    throw new TextTransferContractError('Font registration must declare dedicated transfer ownership.');
  }
  const buffers: ArrayBuffer[] = [];
  appendDedicatedBuffer(buffers, request.bytes, 'font bytes');
  return buffers;
};

export const collectTextResponseTransferBuffers = (
  response: TextLayoutWorkerResponse
): readonly ArrayBuffer[] => {
  if (response.kind === 'glyph-rasterized') {
    if (response.transferOwnership !== 'dedicated') {
      throw new TextTransferContractError('Glyph raster must declare dedicated transfer ownership.');
    }
    const buffers: ArrayBuffer[] = [];
    appendDedicatedBuffer(buffers, response.raster.pixels, 'glyph raster pixels');
    return buffers;
  }
  if (response.kind !== 'text-realized') return [];
  if (response.transferOwnership !== 'dedicated') {
    throw new TextTransferContractError('Realized tables must declare dedicated transfer ownership.');
  }
  const buffers: ArrayBuffer[] = [];
  for (const [index, run] of response.layout.glyphRuns.entries()) {
    appendDedicatedBuffer(buffers, run.glyphIds, `glyph run ${index} IDs`);
    appendDedicatedBuffer(buffers, run.clusters, `glyph run ${index} clusters`);
    appendDedicatedBuffer(buffers, run.geometry, `glyph run ${index} geometry`);
    if (run.transforms) appendDedicatedBuffer(buffers, run.transforms, `glyph run ${index} transforms`);
  }
  return buffers;
};
