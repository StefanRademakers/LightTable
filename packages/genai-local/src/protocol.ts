export const LIGHTTABLE_AI_PROTOCOL_NAME = 'lighttable-ai-provider' as const;
export const LIGHTTABLE_AI_PROTOCOL_VERSION = '1.0' as const;

export type LocalAiOperation = 'image.create' | 'image.edit' | 'image.inpaint';
export type LocalAiHealthStatus = 'starting' | 'downloading' | 'loading-model' | 'ready' | 'busy' | 'error';

export interface LocalAiHealthV1 {
  readonly status: LocalAiHealthStatus;
  readonly protocolVersion: typeof LIGHTTABLE_AI_PROTOCOL_VERSION;
  readonly providerVersion: string;
  readonly modelLoaded: boolean;
  readonly message?: string;
}

export interface LocalAiModelCapabilityV1 {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly operations: readonly LocalAiOperation[];
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface LocalAiCapabilitiesV1 {
  readonly protocol: {
    readonly name: typeof LIGHTTABLE_AI_PROTOCOL_NAME;
    readonly version: typeof LIGHTTABLE_AI_PROTOCOL_VERSION;
  };
  readonly provider: { readonly id: string; readonly name: string; readonly version: string };
  readonly operations: readonly LocalAiOperation[];
  readonly input: {
    readonly supportsBaseImage: boolean;
    readonly supportsReferences: boolean;
    readonly maxReferences: number;
    readonly supportsSelectionMask: boolean;
    readonly selectionMaskFormats: readonly ('alpha' | 'grayscale')[];
    readonly supportedMimeTypes: readonly string[];
  };
  readonly output: {
    readonly supportedMimeTypes: readonly string[];
    readonly supportsAlpha: boolean;
    readonly maxImagesPerJob: number;
  };
  readonly limits: {
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly dimensionMultiple?: number;
  };
  readonly models: readonly LocalAiModelCapabilityV1[];
}

export interface LocalAiMultipartImageRefV1 { readonly field: string; readonly mimeType: string }
export interface LocalAiReferenceRequestV1 {
  readonly id: string;
  readonly image: LocalAiMultipartImageRefV1;
  readonly role?: 'visual' | 'style' | 'character' | 'composition';
}
export interface LocalAiSelectionRequestV1 {
  readonly mask: LocalAiMultipartImageRefV1;
  readonly format: 'alpha' | 'grayscale';
  readonly interpretation: 'alpha-is-selected' | 'white-is-selected';
  readonly featherRadiusPx?: number;
}
export type LocalAiIntentV1 = 'general-create' | 'general-edit' | 'remove-object'
  | 'generative-fill' | 'replace-object' | 'replace-background' | 'expand-canvas'
  | 'create-variation' | `custom:${string}`;
export interface LocalAiImageJobRequestV1 {
  readonly operation: LocalAiOperation;
  readonly intent: LocalAiIntentV1;
  readonly modelId: string;
  readonly prompt: string;
  readonly output: {
    readonly width: number;
    readonly height: number;
    readonly count: number;
    readonly mimeType: 'image/png' | 'image/webp';
    readonly includeAlpha: boolean;
  };
  readonly seed?: number;
  readonly baseImage?: LocalAiMultipartImageRefV1;
  readonly references?: readonly LocalAiReferenceRequestV1[];
  readonly selection?: LocalAiSelectionRequestV1;
  readonly modelSettings?: Readonly<Record<string, unknown>>;
  readonly clientMetadata?: { readonly documentId?: string; readonly commandId?: string };
}

export type LocalAiJobStateV1 = 'queued' | 'loading-model' | 'running' | 'completed' | 'cancelled' | 'failed';
export interface LocalAiJobStatusV1 {
  readonly jobId: string;
  readonly status: LocalAiJobStateV1;
  readonly progress?: number;
  readonly phase?: string;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}
export interface LocalAiJobResultV1 {
  readonly jobId: string;
  readonly images: readonly {
    readonly id: string;
    readonly url: string;
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
  }[];
  readonly generation: {
    readonly providerId: string;
    readonly providerVersion: string;
    readonly modelId: string;
    readonly seed?: number;
    readonly durationMs?: number;
  };
}

export interface LocalAiBinaryInput {
  readonly field: string;
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}
