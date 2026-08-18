import type {
  GenAiAssetId,
  GenAiAssetPayload,
  GenAiGenerationRequest,
  GenAiGenerationSubmission,
  GenAiJobId,
  GenAiProviderId
} from '@lighttable/genai-core';

export interface PreparedPublication {
  readonly assetId: GenAiAssetId;
  readonly url?: string;
  readonly providerAssetId?: string;
  readonly mediaType: string;
  /** Desktop-only prepared bytes used by local runtimes; never crosses IPC. */
  readonly payload?: GenAiAssetPayload;
}

export interface GenerationPreparationContext {
  read(assetId: GenAiAssetId): Promise<GenAiAssetPayload | null>;
  preparePublications(
    providerId: GenAiProviderId,
    assetIds: readonly GenAiAssetId[],
    publish: (asset: GenAiAssetPayload) => Promise<{
      readonly url?: string;
      readonly providerAssetId?: string;
      readonly mediaType: string;
      readonly expiresAt?: number;
    }>
  ): Promise<readonly PreparedPublication[]>;
}

export interface PreparedGeneration {
  readonly references: readonly PreparedPublication[];
}

export interface ProviderGenerationOutput {
  readonly mediaType: string;
  readonly url?: string;
  readonly bytes?: Uint8Array;
}

export interface DesktopGenerationRuntime {
  readonly providerId: GenAiProviderId;
  prepare(request: GenAiGenerationRequest, context: GenerationPreparationContext): Promise<PreparedGeneration>;
  submit(jobId: GenAiJobId, request: GenAiGenerationRequest, prepared: PreparedGeneration): Promise<GenAiGenerationSubmission>;
  wait(providerJobId: string, request: GenAiGenerationRequest, signal: AbortSignal): Promise<readonly ProviderGenerationOutput[]>;
}

export class GenerationRuntimeRegistry {
  private readonly runtimes = new Map<GenAiProviderId, DesktopGenerationRuntime>();
  register(runtime: DesktopGenerationRuntime): void {
    if (this.runtimes.has(runtime.providerId)) throw new Error(`Generation runtime ${runtime.providerId} is already registered.`);
    this.runtimes.set(runtime.providerId, runtime);
  }
  unregister(providerId: GenAiProviderId): void { this.runtimes.delete(providerId); }
  has(providerId: GenAiProviderId): boolean { return this.runtimes.has(providerId); }
  runtime(providerId: GenAiProviderId): DesktopGenerationRuntime {
    const runtime = this.runtimes.get(providerId);
    if (!runtime) throw new Error(`Unsupported GenAI provider: ${providerId}.`);
    return runtime;
  }
}
