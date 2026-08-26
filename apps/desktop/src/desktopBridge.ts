import type {
  LightTableRecoveryListing,
  LightTableRecoveryRecord,
  LightTableRecoveryWriteResult,
  LightTableReleaseInfo,
  LightTableUpdateResult,
  LightTableAgentAccessStatus,
  LightTableAgentClientScope,
  LightTableAgentTunnelStatus,
  LightTableLocalMcpTestStatus
} from '@lighttable/app';
import type {
  LightTableLocalAiConnectionSettings,
  LightTableLocalAiConnectionTest
} from '@lighttable/app';
import type { LightTableRecoveryLocation } from '@lighttable/app';
import type {
  ProjectFolderMappings,
  ProjectLastUsedDocument,
  ProjectUserFolder,
  ProjectUserStorageLocation
} from '@lighttable/app/project-manifest';
import type {
  GenAiAssetId,
  GenAiAssetReference,
  GenAiProjectAssetCatalog,
  GenAiGenerationRequest,
  GenAiGenerationJob,
  GenAiGenerationSubmission,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiProviderSnapshot,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import type { LocalAiModelStatus } from './genai/localAiModelManager';
import type { NativeBitmapFormatId } from '@lighttable/app/bitmap-formats';

export interface DesktopFilePayload {
  name: string;
  type: string;
  bytes?: Uint8Array;
  sourcePath?: string;
  mediaSource?: {
    readonly id: string;
    readonly url: string;
    readonly byteLength: number;
  };
}

export interface DesktopSavePayload {
  suggestedName: string;
  bytes: Uint8Array;
  replaceSource?: {
    readonly path: string;
    readonly format: NativeBitmapFormatId;
  };
  projectManifestPath?: string;
  transaction?: {
    readonly id: string;
    readonly documentId: string;
    readonly revision: number;
  };
}

export type DesktopSaveResult =
  | {
      readonly status: 'committed';
      readonly durability: 'atomic-replace' | 'safe-replace';
    }
  | { readonly status: 'canceled' }
  | {
      readonly status: 'failed';
      readonly phase: string;
      readonly message: string;
    };

export interface DesktopRecoveryWritePayload {
  readonly documentId: string;
  readonly record: LightTableRecoveryRecord;
  readonly bytes: Uint8Array;
}

export interface DesktopRecoveryReadPayload {
  readonly record: LightTableRecoveryRecord;
  readonly bytes: Uint8Array;
}

export interface DesktopRecentFile {
  id: string;
  name: string;
  available: boolean;
}

export interface DesktopProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly lastUsedDocument: ProjectLastUsedDocument | null;
}

export interface DesktopRecentProject extends DesktopProjectSummary {
  readonly recentId: string;
  readonly available: boolean;
}

export interface DesktopProjectLocation {
  readonly path: string;
  readonly label: string;
}

export interface DesktopHorizontalWheelInput {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
}

export interface DesktopSystemFontAsset {
  readonly assetId: string;
  readonly faceIndex: number;
  readonly fingerprintSha256: string;
  readonly source: 'system';
  readonly container: 'sfnt';
  readonly outline: 'truetype' | 'cff' | 'cff2' | 'svg' | 'bitmap' | 'mixed' | 'unknown';
  readonly postScriptName?: string;
  readonly embedding: {
    readonly level: 'installable' | 'editable' | 'preview-print' | 'restricted' | 'unknown';
    readonly noSubsetting: boolean;
    readonly bitmapOnly: boolean;
  };
  readonly familyNames: readonly string[];
  readonly styleName: string;
  readonly weight: number;
  readonly stretch: number;
  readonly italic: boolean;
  readonly byteLength: number;
  readonly variableAxes?: readonly {
    readonly tag: string;
    readonly minimum: number;
    readonly defaultValue: number;
    readonly maximum: number;
  }[];
}

export interface DesktopClipboardImagePayload {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';
  readonly sourceFormat: string;
}

export interface LightTableDesktopBridge {
  readonly automationEnabled: boolean;
  toggleDeveloperTools(): Promise<void>;
  openFile(): Promise<DesktopFilePayload | null>;
  openFiles(): Promise<readonly DesktopFilePayload[]>;
  takeInitialLaunchFiles(): Promise<readonly DesktopFilePayload[]>;
  takeLaunchFiles(): Promise<readonly DesktopFilePayload[]>;
  releaseMediaSource(id: string): Promise<void>;
  onLaunchFilesAvailable(listener: () => void): () => void;
  listRecentFiles(): Promise<readonly DesktopRecentFile[]>;
  loadRecentFileThumbnail(id: string): Promise<string | null>;
  openRecentFile(id: string): Promise<DesktopFilePayload | null>;
  rememberOpenedFiles(files: readonly File[]): Promise<void>;
  revealRecentFile(id: string): Promise<void>;
  removeRecentFile(id: string): Promise<void>;
  clearRecentFiles(): Promise<void>;
  chooseProjectParent(): Promise<DesktopProjectLocation | null>;
  createProject(request: {
    readonly name: string;
    readonly parentPath: string;
    readonly folders?: ProjectFolderMappings;
    readonly createFolders?: readonly ProjectUserStorageLocation[];
    readonly userFolders?: readonly ProjectUserFolder[];
  }): Promise<DesktopProjectSummary>;
  currentProject(): Promise<DesktopProjectSummary | null>;
  openProject(): Promise<DesktopProjectSummary | null>;
  listRecentProjects(): Promise<readonly DesktopRecentProject[]>;
  openRecentProject(recentId: string): Promise<DesktopProjectSummary | null>;
  loadRecentProjectThumbnail(recentId: string): Promise<string | null>;
  openProjectLastUsedDocument(projectId: string): Promise<DesktopFilePayload | null>;
  revealProject(manifestPath: string): Promise<void>;
  closeProject(): Promise<void>;
  removeRecentProject(recentId: string): Promise<void>;
  clearRecentProjects(): Promise<void>;
  setFullscreen(enabled: boolean): Promise<void>;
  closeApplication(): Promise<void>;
  readActionLibrary(): Promise<string | null>;
  writeActionLibrary(value: string): Promise<void>;
  onFullscreenChange(listener: (enabled: boolean) => void): () => void;
  onHorizontalWheel(listener: (input: DesktopHorizontalWheelInput) => void): () => void;
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  saveFile(payload: DesktopSavePayload): Promise<DesktopSaveResult>;
  writeRecovery(payload: DesktopRecoveryWritePayload): Promise<LightTableRecoveryWriteResult>;
  removeRecovery(documentId: string, throughRevision?: number): Promise<void>;
  removeRecoveryRecord(recoveryId: string): Promise<void>;
  listRecoveries(): Promise<LightTableRecoveryListing>;
  readRecovery(recoveryId: string): Promise<DesktopRecoveryReadPayload | null>;
  recoveryLocation(): Promise<LightTableRecoveryLocation>;
  chooseRecoveryLocation(): Promise<LightTableRecoveryLocation | null>;
  resetRecoveryLocation(): Promise<LightTableRecoveryLocation>;
  applyRecoveryLocation(path?: string): Promise<LightTableRecoveryLocation>;
  writeClipboardPng(bytes: Uint8Array): Promise<void>;
  readClipboardImage(): Promise<DesktopClipboardImagePayload | null>;
  listSystemFonts(): Promise<readonly DesktopSystemFontAsset[]>;
  loadSystemFont(assetId: string): Promise<Uint8Array | null>;
  releaseInfo(): Promise<LightTableReleaseInfo>;
  checkForUpdates(): Promise<LightTableUpdateResult>;
  restartToInstallUpdate(dirtyDocuments: boolean): Promise<{
    readonly status: 'restarting' | 'blocked' | 'unavailable';
    readonly message?: string;
  }>;
  agentAccessStatus(): Promise<LightTableAgentAccessStatus>;
  enableAgentAccess(port?: number): Promise<LightTableAgentAccessStatus>;
  disableAgentAccess(): Promise<LightTableAgentAccessStatus>;
  rotateAgentAccessCredentials(): Promise<LightTableAgentAccessStatus>;
  onAgentAccessStatus(listener: (status: LightTableAgentAccessStatus) => void): () => void;
  installAgentAccessHandler(handler: (method: string, parameters: unknown) => Promise<unknown>): () => void;
  agentTunnelStatus(): Promise<LightTableAgentTunnelStatus>;
  pairAgentServer(serverUrl: string, code: string): Promise<LightTableAgentTunnelStatus>;
  disconnectAgentServer(): Promise<LightTableAgentTunnelStatus>;
  reconnectAgentServer(): Promise<LightTableAgentTunnelStatus>;
  approveAgentClient(clientId: string, scopes: readonly LightTableAgentClientScope[], persistent?: boolean): Promise<LightTableAgentTunnelStatus>;
  localMcpTestStatus(): Promise<LightTableLocalMcpTestStatus>;
  startLocalMcpTest(): Promise<LightTableLocalMcpTestStatus>;
  stopLocalMcpTest(): Promise<LightTableLocalMcpTestStatus>;
  authorizeLocalMcpCodex(): Promise<LightTableLocalMcpTestStatus>;
  onLocalMcpTestStatus(listener: (status: LightTableLocalMcpTestStatus) => void): () => void;
  revokeAgentClient(clientId: string): Promise<LightTableAgentTunnelStatus>;
  revokeAgentDevice(): Promise<LightTableAgentTunnelStatus>;
  cancelAgentActivity(): Promise<LightTableAgentTunnelStatus>;
  undoAgentActivity(): Promise<LightTableAgentTunnelStatus>;
  onAgentTunnelStatus(listener: (status: LightTableAgentTunnelStatus) => void): () => void;
  genAiProviderSnapshots(): Promise<readonly GenAiProviderSnapshot[]>;
  connectGenAiProvider(providerId: GenAiProviderId): Promise<GenAiProviderSnapshot>;
  disconnectGenAiProvider(providerId: GenAiProviderId): Promise<GenAiProviderSnapshot>;
  listGenAiModels(providerId: GenAiProviderId): Promise<readonly GenAiModelSummary[]>;
  loadGenAiWorkflow(
    providerId: GenAiProviderId,
    modelId: GenAiModelId,
    mode: string
  ): Promise<GenAiWorkflowDefinition>;
  estimateGenAiCost(providerId: GenAiProviderId, modelId: GenAiModelId, mode: string,
    fields: Readonly<Record<string, unknown>>): Promise<import('@lighttable/genai-core').GenAiCostEstimate | null>;
  submitGenAiGeneration(
    projectId: string | undefined,
    request: GenAiGenerationRequest
  ): Promise<GenAiGenerationSubmission>;
  listGenAiJobs(projectId: string): Promise<readonly GenAiGenerationJob[]>;
  stopGenAiJobTracking(projectId: string, jobId: import('@lighttable/genai-core').GenAiJobId): Promise<GenAiGenerationJob>;
  resumeGenAiJobTracking(projectId: string, jobId: import('@lighttable/genai-core').GenAiJobId): Promise<GenAiGenerationJob>;
  revealGenAiResult(projectId: string, jobId: import('@lighttable/genai-core').GenAiJobId): Promise<void>;
  deleteGenAiJob(projectId: string, jobId: import('@lighttable/genai-core').GenAiJobId): Promise<void>;
  loadGenAiProjectAssetCatalog(projectId: string): Promise<GenAiProjectAssetCatalog>;
  refreshGenAiProjectAssets(projectId: string): Promise<void>;
  loadGenAiProjectAssetPreview(projectId: string, assetId: GenAiAssetId): Promise<string | null>;
  loadGenAiProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<import('@lighttable/genai-core').GenAiAssetPayload | null>;
  importGenAiProjectAsset(projectId: string, asset: import('@lighttable/genai-core').GenAiAssetPayload): Promise<GenAiAssetReference>;
  revealGenAiProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<void>;
  renameGenAiProjectAsset(projectId: string, assetId: GenAiAssetId, name: string): Promise<GenAiAssetReference>;
  deleteGenAiProjectAsset(projectId: string, assetId: GenAiAssetId): Promise<void>;
  loadGenAiProjectSetup(projectId: string): Promise<import('@lighttable/genai-core').GenAiProjectSetup | null>;
  saveGenAiProjectSetup(projectId: string, setup: import('@lighttable/genai-core').GenAiProjectSetup): Promise<void>;
  onGenAiProviderStatus(listener: (snapshot: GenAiProviderSnapshot) => void): () => void;
  localAiModelStatus(): Promise<LocalAiModelStatus>;
  installLocalAiModel(): Promise<LocalAiModelStatus>;
  configureLocalAi(settings: LightTableLocalAiConnectionSettings): Promise<void>;
  testLocalAiConnection(settings: LightTableLocalAiConnectionSettings): Promise<LightTableLocalAiConnectionTest>;
  configureAiProviders(providers: readonly import('@lighttable/app').LightTableAiProviderConfig[]): Promise<void>;
  testAiProvider(provider: import('@lighttable/app').LightTableAiProviderConfig): Promise<LightTableLocalAiConnectionTest>;
  openAiProviderHelp(provider: import('@lighttable/app').LightTableAiProviderConfig): Promise<void>;
  onLocalAiModelStatus(listener: (status: LocalAiModelStatus) => void): () => void;
  onGenAiProjectAssetsChanged(listener: (projectId: string) => void): () => void;
  onGenAiJobChanged(listener: (event: {
    readonly projectId: string;
    readonly job: GenAiGenerationJob;
  }) => void): () => void;
}
