import type {
  LightTableRecoveryListing,
  LightTableRecoveryRecord,
  LightTableRecoveryWriteResult,
  LightTableReleaseInfo,
  LightTableUpdateResult,
  LightTableAgentAccessStatus,
  LightTableAgentClientScope,
  LightTableAgentTunnelStatus
} from '@lighttable/app';

export interface DesktopFilePayload {
  name: string;
  type: string;
  bytes: Uint8Array;
  sourcePath?: string;
}

export interface DesktopSavePayload {
  suggestedName: string;
  bytes: Uint8Array;
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

export interface LightTableDesktopBridge {
  readonly automationEnabled: boolean;
  openFile(): Promise<DesktopFilePayload | null>;
  listRecentFiles(): Promise<readonly DesktopRecentFile[]>;
  loadRecentFileThumbnail(id: string): Promise<string | null>;
  openRecentFile(id: string): Promise<DesktopFilePayload | null>;
  removeRecentFile(id: string): Promise<void>;
  clearRecentFiles(): Promise<void>;
  setFullscreen(enabled: boolean): Promise<void>;
  onFullscreenChange(listener: (enabled: boolean) => void): () => void;
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  saveFile(payload: DesktopSavePayload): Promise<DesktopSaveResult>;
  writeRecovery(payload: DesktopRecoveryWritePayload): Promise<LightTableRecoveryWriteResult>;
  removeRecovery(documentId: string, throughRevision?: number): Promise<void>;
  removeRecoveryRecord(recoveryId: string): Promise<void>;
  listRecoveries(): Promise<LightTableRecoveryListing>;
  readRecovery(recoveryId: string): Promise<DesktopRecoveryReadPayload | null>;
  writeClipboardPng(bytes: Uint8Array): Promise<void>;
  readClipboardPng(): Promise<Uint8Array | null>;
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
  approveAgentClient(clientId: string, scopes: readonly LightTableAgentClientScope[]): Promise<LightTableAgentTunnelStatus>;
  revokeAgentClient(clientId: string): Promise<LightTableAgentTunnelStatus>;
  revokeAgentDevice(): Promise<LightTableAgentTunnelStatus>;
  cancelAgentActivity(): Promise<LightTableAgentTunnelStatus>;
  undoAgentActivity(): Promise<LightTableAgentTunnelStatus>;
  onAgentTunnelStatus(listener: (status: LightTableAgentTunnelStatus) => void): () => void;
}
