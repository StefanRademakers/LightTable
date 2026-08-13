export type GenAiProviderId = string & { readonly __genAiProviderId: unique symbol };
export type GenAiModelId = string & { readonly __genAiModelId: unique symbol };
export type GenAiWorkflowId = string & { readonly __genAiWorkflowId: unique symbol };
export type GenAiJobId = string & { readonly __genAiJobId: unique symbol };
export type GenAiAssetId = string & { readonly __genAiAssetId: unique symbol };

export type GenAiProviderStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'expired';

export interface GenAiProviderSnapshot {
  readonly id: GenAiProviderId;
  readonly label: string;
  readonly status: GenAiProviderStatus;
  readonly message?: string;
  readonly connectedAt?: number;
}

export interface GenAiModelSummary {
  readonly id: GenAiModelId;
  readonly providerId: GenAiProviderId;
  readonly label: string;
  readonly description?: string;
  readonly capabilities: readonly string[];
}

export type GenAiFieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'asset'
  | 'unknown';

/**
 * Provider-independent meaning used by LightTable's shared generation UI.
 * Provider adapters assign these roles while retaining the original field key
 * for validation and submission.
 */
export type GenAiFieldRole =
  | 'prompt'
  | 'references'
  | 'aspect-ratio'
  | 'output-size'
  | 'quality'
  | 'output-count';

export interface GenAiFieldDefinition {
  readonly key: string;
  readonly role?: GenAiFieldRole;
  readonly label: string;
  readonly kind: GenAiFieldKind;
  readonly required: boolean;
  readonly advanced: boolean;
  readonly description?: string;
  readonly defaultValue?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Original provider fragment retained for diagnostics and forward compatibility. */
  readonly sourceSchema: Readonly<Record<string, unknown>>;
}

export interface GenAiWorkflowDefinition {
  readonly id: GenAiWorkflowId;
  readonly providerId: GenAiProviderId;
  readonly modelId: GenAiModelId;
  readonly label: string;
  readonly mode: string;
  readonly fields: readonly GenAiFieldDefinition[];
  readonly sourceVersion?: string;
}

export interface GenAiAssetReference {
  readonly id: GenAiAssetId;
  readonly projectId: string;
  readonly label: string;
  readonly mediaType: string;
  /** Portable project-relative path used for grouping and file operations. */
  readonly relativePath?: string;
  /** Human-facing project folder section, resolved by the desktop host. */
  readonly section?: string;
  readonly previewId?: string;
  /** Last file modification time supplied by the project host. */
  readonly modifiedAt?: string;
  /** Providers for which the desktop host has a reachable, non-local media URL. */
  readonly publishedProviderIds?: readonly GenAiProviderId[];
}

export interface GenAiProjectAssetSection {
  /** Stable portable project-relative directory path. */
  readonly id: string;
  readonly label: string;
}

/** Provider-independent view of the files and visible directories in a project. */
export interface GenAiProjectAssetCatalog {
  readonly sections: readonly GenAiProjectAssetSection[];
  readonly assets: readonly GenAiAssetReference[];
}

export interface GenAiPromptBinding {
  readonly token: string;
  readonly assetId: GenAiAssetId;
  readonly providerLabel?: string;
}

/** Provider-independent output intent retained with a durable generation job. */
export interface GenAiRequestedOutput {
  readonly aspectRatio?: string;
  readonly size?: string;
  readonly quality?: string;
  readonly count?: number;
}

export interface GenAiGenerationRequest {
  readonly providerId: GenAiProviderId;
  readonly modelId: GenAiModelId;
  readonly workflowId: GenAiWorkflowId;
  /** Human-readable prompt retained exactly as edited. */
  readonly prompt: string;
  /** Provider-position prompt after stable asset tokens are resolved. */
  readonly providerPrompt: string;
  readonly promptBindings: readonly GenAiPromptBinding[];
  readonly output?: GenAiRequestedOutput;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly references: readonly GenAiAssetReference[];
}

export interface GenAiGenerationSubmission {
  readonly jobId: GenAiJobId;
  readonly providerJobId: string;
  readonly status: 'submitted' | 'succeeded';
  readonly result?: GenAiGenerationResult;
}

export interface GenAiCostEstimate {
  readonly amount: number;
  readonly unit: string;
  readonly label: string;
}

export type GenAiJobStatus =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown-submit';

export interface GenAiGenerationResult {
  readonly assetId: GenAiAssetId;
  readonly mediaType: string;
  readonly fileName?: string;
  readonly previewId?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface GenAiAssetPayload {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface GenAiProjectSetup {
  readonly modelId: GenAiModelId;
  readonly mode: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly updatedAt: number;
}

export interface GenAiGenerationJob {
  readonly id: GenAiJobId;
  readonly request: GenAiGenerationRequest;
  readonly status: GenAiJobStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly providerJobId?: string;
  readonly error?: string;
  readonly results: readonly GenAiGenerationResult[];
}

export interface GenAiProviderAdapter {
  readonly providerId: GenAiProviderId;
  loadModels(): Promise<readonly GenAiModelSummary[]>;
  loadWorkflow(modelId: GenAiModelId): Promise<GenAiWorkflowDefinition>;
  submit(jobId: GenAiJobId, request: GenAiGenerationRequest): Promise<string>;
  poll(providerJobId: string): Promise<GenAiGenerationJob>;
  cancel(providerJobId: string): Promise<void>;
}

export interface GenAiProjectPort {
  listAssets(projectId: string): Promise<readonly GenAiAssetReference[]>;
  storeResult(
    projectId: string,
    jobId: GenAiJobId,
    source: AsyncIterable<Uint8Array>,
    mediaType: string
  ): Promise<GenAiGenerationResult>;
}

/** Safe renderer-facing host commands. Implementations live outside React. */
export interface GenAiHostPort {
  getProviderSnapshots(): Promise<readonly GenAiProviderSnapshot[]>;
  connectProvider(providerId: GenAiProviderId): Promise<GenAiProviderSnapshot>;
  disconnectProvider(providerId: GenAiProviderId): Promise<GenAiProviderSnapshot>;
  listModels(providerId: GenAiProviderId): Promise<readonly GenAiModelSummary[]>;
  loadWorkflow(
    providerId: GenAiProviderId,
    modelId: GenAiModelId,
    mode: string
  ): Promise<GenAiWorkflowDefinition>;
  estimateCost(
    providerId: GenAiProviderId,
    modelId: GenAiModelId,
    mode: string,
    fields: Readonly<Record<string, unknown>>
  ): Promise<GenAiCostEstimate | null>;
  submitGeneration(
    projectId: string | undefined,
    request: GenAiGenerationRequest
  ): Promise<GenAiGenerationSubmission>;
  listJobs(projectId: string): Promise<readonly GenAiGenerationJob[]>;
  /** Stops local polling only; it never claims to cancel a paid provider job. */
  stopTracking(projectId: string, jobId: GenAiJobId): Promise<GenAiGenerationJob>;
  /** Resumes a known provider job without submitting or charging again. */
  resumeTracking(projectId: string, jobId: GenAiJobId): Promise<GenAiGenerationJob>;
  revealResult(projectId: string, jobId: GenAiJobId): Promise<void>;
  deleteJob(projectId: string, jobId: GenAiJobId): Promise<void>;
  loadProjectAssetCatalog(projectId: string): Promise<GenAiProjectAssetCatalog>;
  refreshProjectAssets(projectId: string): Promise<void>;
  loadProjectAssetPreview(projectId: string, assetId: GenAiAssetId): Promise<string | null>;
  loadProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<GenAiAssetPayload | null>;
  importProjectAsset(projectId: string, asset: GenAiAssetPayload): Promise<GenAiAssetReference>;
  revealProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<void>;
  renameProjectAsset(projectId: string, assetId: GenAiAssetId, name: string): Promise<GenAiAssetReference>;
  deleteProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<void>;
  loadProjectSetup(projectId: string): Promise<GenAiProjectSetup | null>;
  saveProjectSetup(projectId: string, setup: GenAiProjectSetup): Promise<void>;
}
