import './ui/theme.css';
import './ui/appTheme';
import './ui/primitives.css';

export {
  LightTableEditorOverlay,
  type LightTableEditorOverlayProps
} from './lighttable/LightTableEditorOverlay';
export { LightTableStandaloneApp } from './standalone/LightTableStandaloneApp';
export { createBrowserHost } from './platform/LightTableHost';
export {
  browserImageClipboard,
  createLightTableImageClipboard
} from './platform/LightTableImageClipboard';
export {
  WorkspaceSession,
  type CloseDocumentOptions,
  type OpenDocumentOptions,
  type WorkspaceSessionOptions,
  type WorkspaceError,
  type WorkspaceSnapshot
} from './lighttable/application/workspace/workspaceSession';
export {
  DocumentWorkspaceController,
  type OpenWorkspaceDocument
} from './lighttable/application/workspace/documentWorkspaceController';
export {
  DocumentSession,
  type DocumentLifecycle,
  type DocumentSessionId,
  type DocumentSessionSnapshot,
  type DocumentSourceDescriptor,
  type DocumentViewport
} from './lighttable/application/documents/documentSession';
export type { SystemFontByteProvider } from './lighttable/text/fonts/DocumentFontRegistry';
export type { DocumentFontAsset } from './lighttable/editor/document/documentTypes';
export {
  DocumentCommandHistory,
  type DocumentCommandHistoryOptions,
  type DocumentCommandHistorySnapshot,
  type ReversibleDocumentCommand
} from './lighttable/application/commands/documentCommandHistory';
export {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  LightTableCommandPortRegistry,
  LightTableCommandService,
  type CommandCapabilitySummary,
  type DocumentQueryResult,
  type LayerQuerySummary,
  type LayerListQueryResult,
  type LayerDetailQueryResult,
  type LayerPreviewResult,
  type LightTableCommandErrorCode,
  type LightTableCommandId,
  type LightTableCommandPorts,
  type LightTableWorkspaceCommandPorts,
  type DocumentLightTableCommandPorts,
  type LightTableCommandRequest,
  type LightTableCommandResult,
  type LightTableAutomationDriver,
  type LightTableRevisionSet,
  type WorkspaceDocumentSummary,
  type WorkspaceQueryResult
} from './lighttable/application/commands/lightTableCommandService';
export type {
  AdjustmentQueryResult,
  AdjustmentQueryTarget,
  AdjustmentModuleProjection,
  AdjustmentParameterProjection
} from './lighttable/application/adjustments/adjustmentQuery';
export {
  AuthenticatedLightTableMcpAdapter,
  LIGHTTABLE_MCP_PROTOCOL_VERSION,
  type AuthenticatedLightTableMcpAdapterOptions,
  type LightTableMcpActivityEntry,
  type LightTableMcpMethod,
  type LightTableMcpRequest,
  type LightTableMcpResult
} from './lighttable/application/commands/lightTableMcpAdapter';
export { isLightTableAgentAccessCommandId } from '@lighttable/command-contract';
export {
  DocumentTaskRegistry,
  type DocumentTaskContext,
  type DocumentTaskKind,
  type DocumentTaskRegistrySnapshot,
  type DocumentTaskResult,
  type DocumentTaskState
} from './lighttable/application/tasks/documentTaskRegistry';
export {
  DocumentRendererLifecycle,
  type DocumentRendererSnapshot,
  type DocumentRendererStatus
} from './lighttable/application/rendering/documentRendererLifecycle';
export {
  LIGHTTABLE_RESOURCE_PAGE_SIZE,
  LIGHTTABLE_RESOURCE_PAGE_SIZE_MAX,
  LightTableResourceBrowser,
  type LightTableResourceKind,
  type LightTableResourcePage,
  type LightTableResourceProvider,
  type LightTableResourceQuery,
  type LightTableResourceSummary
} from './lighttable/application/resources/resourceBrowser';
export { createFontResourceProvider } from './lighttable/application/resources/fontResourceProvider';
export {
  LIGHTTABLE_PROJECT_FORMAT,
  LIGHTTABLE_PROJECT_VERSION,
  LIGHTTABLE_PROJECT_MANIFEST_NAME,
  PROJECT_STORAGE_LOCATIONS,
  PROJECT_USER_STORAGE_LOCATIONS,
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  createLightTableProjectManifest,
  parseLightTableProjectManifest,
  normalizeProjectUserFolders,
  projectStorageRelativePath,
  type LightTableProjectManifest,
  type ProjectFolderMappings,
  type ProjectLastUsedDocument,
  type ProjectUserFolder,
  type ProjectStorageLocation,
  type ProjectUserStorageLocation
} from './lighttable/application/projects/projectManifest';
export {
  copyLightTableGrade,
  readLightTableGrade,
  useLightTableGradeClipboard,
  type LightTableGradeClipboard
} from './lighttable/lightTableGradeClipboard';
export {
  createLightTableRecipe,
  parseLightTableRecipe,
  parseLightTableSettings,
  resolveLightTableEditorSourceKey,
  resolveLightTableRecipe,
  type LightTableRecipe
} from './lighttable/lightTableRecipe';
export { renderLightTableGrade } from './lighttable/renderLightTableGrade';
export {
  configureVectorRendererDetailedProfiling
} from './lighttable/gpu/vectorRendererBackendDiagnostics';
export { useLightTableRecipe } from './lighttable/useLightTableRecipe';
export type { BasicAdjustments } from './lighttable/types';
export type {
  LightTableHost,
  LightTableMediaBrowser,
  LightTableMediaItem,
  LightTableRecentFile,
  LightTableProjectSummary,
  LightTableRecentProject,
  LightTableProjectLocation,
  LightTableProjectService,
  LightTableReleaseChannel,
  LightTableReleaseInfo,
  LightTableReleaseService,
  LightTableAgentAccessService,
  LightTableAgentAccessStatus,
  LightTableAgentTunnelStatus,
  LightTableLocalMcpTestStatus,
  LightTableAgentTunnelState,
  LightTableAgentClientScope,
  LightTableAgentClient,
  LightTableAiProviderConfig,
  LightTableLocalAiConnectionSettings,
  LightTableLocalAiConnectionTest,
  LightTableUpdateResult,
  LightTableSaveRequest
} from './platform/LightTableHost';
export {
  LIGHTTABLE_RECOVERY_VERSION,
  parseLightTableRecoveryRecord,
  sha256Hex,
  type LightTableRecoveryEntry,
  type LightTableRecoveryListing,
  type LightTableRecoveryLocation,
  type LightTableRecoveryLocationService,
  type LightTableRecoveryRecord,
  type LightTableRecoveryRejection,
  type LightTableRecoveryStore,
  type LightTableRecoveryWriteRequest,
  type LightTableRecoveryWriteResult
} from './platform/LightTableRecoveryStore';
export type {
  LightTableClipboardImage,
  LightTableClipboardImagePlacement,
  LightTableImageClipboard,
  LightTableImageClipboardTransport
} from './platform/LightTableImageClipboard';
export {
  createLocalLightTableFunnelTelemetry,
  type LightTableFunnelEvent,
  type LightTableFunnelTelemetry
} from './platform/LightTableFunnelTelemetry';
