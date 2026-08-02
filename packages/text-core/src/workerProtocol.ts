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

interface TextWorkerMessageIdentity {
  readonly protocolVersion: typeof TEXT_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly documentSessionId: string;
  readonly sessionGeneration: number;
}

export interface TextWorkerFontRegistrationRequest extends TextWorkerMessageIdentity {
  readonly kind: 'register-font';
  readonly font: FontAssetRef;
  /** Dedicated, full-span JS-owned storage. Ownership moves to the worker. */
  readonly bytes: Uint8Array;
  readonly transferOwnership: 'dedicated';
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

export type TextWorkerRequest = TextWorkerFontRegistrationRequest | TextLayoutWorkerRequest;

interface TextWorkerResponseIdentity extends TextWorkerMessageIdentity {
  readonly cacheKey?: string;
}

export type TextLayoutWorkerResponse =
  | TextWorkerResponseIdentity & {
    readonly kind: 'font-registered';
    readonly assetId: string;
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'text-realized';
    readonly cacheKey: string;
    readonly layout: RealizedTextLayout;
    /** Every typed table owns a distinct, full-span JS ArrayBuffer. */
    readonly transferOwnership: 'dedicated';
  }
  | TextWorkerResponseIdentity & {
    readonly kind: 'text-layout-failed';
    readonly cacheKey: string;
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
  if (request.transferOwnership !== 'dedicated') {
    throw new TextTransferContractError('Font registration must declare dedicated transfer ownership.');
  }
  const buffers: ArrayBuffer[] = [];
  appendDedicatedBuffer(buffers, request.bytes, 'font bytes');
  return buffers;
};

export const collectTextResponseTransferBuffers = (
  response: TextLayoutWorkerResponse
): readonly ArrayBuffer[] => {
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
