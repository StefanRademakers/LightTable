export const TEXT_ENGINE_PROTOCOL_VERSION = 1 as const;

export interface TextEngineProbeRequest {
  readonly kind: 'probe';
  readonly protocolVersion: typeof TEXT_ENGINE_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface TextEngineInspectFontRequest {
  readonly kind: 'inspect-font';
  readonly protocolVersion: typeof TEXT_ENGINE_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  readonly faceIndex: number;
}

export interface TextEngineFontInspection {
  readonly glyphCount: number;
  readonly unitsPerEm: number;
  readonly axisCount: number;
  readonly outline: 'truetype' | 'cff' | 'cff2' | 'unknown';
  readonly embeddingLevel: 'installable' | 'editable' | 'preview-print' | 'restricted';
  readonly noSubsetting: boolean;
  readonly bitmapOnly: boolean;
}

export interface TextEngineFontInspectedResponse extends TextEngineFontInspection {
  readonly kind: 'font-inspected';
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

export type TextEngineWorkerRequest = TextEngineProbeRequest | TextEngineInspectFontRequest;
export type TextEngineWorkerResponse =
  | TextEngineReadyResponse
  | TextEngineFontInspectedResponse
  | TextEngineErrorResponse;

export interface TextEngineCapability {
  readonly engineVersion: string;
  readonly loadDurationMs: number;
}
