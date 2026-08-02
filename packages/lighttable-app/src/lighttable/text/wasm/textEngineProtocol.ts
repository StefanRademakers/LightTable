export const TEXT_ENGINE_PROTOCOL_VERSION = 1 as const;

export interface TextEngineProbeRequest {
  readonly kind: 'probe';
  readonly protocolVersion: typeof TEXT_ENGINE_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface TextEngineReadyResponse {
  readonly kind: 'ready';
  readonly protocolVersion: typeof TEXT_ENGINE_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineVersion: string;
  readonly loadDurationMs: number;
}

export interface TextEngineErrorResponse {
  readonly kind: 'error';
  readonly protocolVersion: typeof TEXT_ENGINE_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly message: string;
}

export type TextEngineWorkerRequest = TextEngineProbeRequest;
export type TextEngineWorkerResponse = TextEngineReadyResponse | TextEngineErrorResponse;

export interface TextEngineCapability {
  readonly engineVersion: string;
  readonly loadDurationMs: number;
}
