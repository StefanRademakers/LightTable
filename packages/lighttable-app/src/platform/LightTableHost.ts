import type { LightTableImageClipboard } from './LightTableImageClipboard';
import { browserImageClipboard } from './LightTableImageClipboard';
import type { LightTableAutomationDriver } from '../lighttable/application/commands/lightTableCommandService';
import type { DocumentFontAsset } from '../lighttable/editor/document/documentTypes';
import type { SystemFontByteProvider } from '../lighttable/text/fonts/DocumentFontRegistry';
import type { LightTableRecoveryStore } from './LightTableRecoveryStore';
import { createBrowserRecoveryStore } from './BrowserRecoveryStore';
import {
  createLocalLightTableFunnelTelemetry,
  type LightTableFunnelTelemetry
} from './LightTableFunnelTelemetry';
import type { ProjectFolderMappings, ProjectUserFolder } from '../lighttable/application/projects/projectManifest';
import type {
  GenAiHostPort,
  GenAiProviderSnapshot
} from '@lighttable/genai-core';

export interface LightTableMediaItem {
  id: string;
  name: string;
  mediaType: string;
  thumbnailUrl?: string;
}

export interface LightTableMediaBrowser {
  browse(options?: {
    accept?: readonly string[];
    multiple?: boolean;
  }): Promise<readonly LightTableMediaItem[]>;
  read(item: LightTableMediaItem, signal?: AbortSignal): Promise<Blob>;
}

export interface LightTableSaveRequest {
  file: File;
  recipe: unknown;
  projectManifestPath?: string;
  transaction?: {
    readonly id: string;
    readonly documentId: string;
    readonly revision: number;
  };
}

export type LightTableSaveDurability =
  | 'atomic-replace'
  | 'safe-replace'
  | 'download';

export type LightTableSaveResult =
  | {
      readonly status: 'committed';
      readonly durability: LightTableSaveDurability;
    }
  | { readonly status: 'canceled' }
  | {
      readonly status: 'failed';
      readonly phase: string;
      readonly message: string;
    };

export interface LightTableRecentFile {
  id: string;
  name: string;
  available: boolean;
  thumbnailUrl?: string;
}

export interface LightTableProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly manifestPath: string;
}

export interface LightTableRecentProject extends LightTableProjectSummary {
  readonly recentId: string;
  readonly available: boolean;
}

export interface LightTableProjectLocation {
  readonly path: string;
  readonly label: string;
}

export interface LightTableProjectService {
  /** Returns the project currently owned by the host after renderer reloads. */
  current(): Promise<LightTableProjectSummary | null>;
  chooseParentLocation(): Promise<LightTableProjectLocation | null>;
  create(request: {
    readonly name: string;
    readonly parentPath: string;
    readonly folders?: ProjectFolderMappings;
    readonly userFolders?: readonly ProjectUserFolder[];
  }): Promise<LightTableProjectSummary>;
  open(): Promise<LightTableProjectSummary | null>;
  listRecent(): Promise<readonly LightTableRecentProject[]>;
  openRecent(recentId: string): Promise<LightTableProjectSummary | null>;
  reveal(project: LightTableProjectSummary): Promise<void>;
  close(): Promise<void>;
  removeRecent(recentId: string): Promise<void>;
  clearRecent(): Promise<void>;
}

export type LightTableReleaseChannel = 'dev' | 'preview' | 'stable';

export interface LightTableReleaseInfo {
  readonly version: string;
  readonly channel: LightTableReleaseChannel;
  readonly build: string;
  readonly packaged: boolean;
  readonly signed: boolean;
  readonly updateConfigured: boolean;
}

export type LightTableUpdateResult =
  | { readonly status: 'current' | 'older' | 'channel-blocked'; readonly version: string }
  | {
      readonly status: 'downloaded';
      readonly version: string;
      readonly releaseNotes: string;
      readonly canInstall: boolean;
    }
  | { readonly status: 'unavailable' | 'invalid' | 'canceled'; readonly message: string };

export interface LightTableReleaseService {
  info(): Promise<LightTableReleaseInfo>;
  checkForUpdates(): Promise<LightTableUpdateResult>;
  restartToInstall(options: { readonly dirtyDocuments: boolean }): Promise<{
    readonly status: 'restarting' | 'blocked' | 'unavailable';
    readonly message?: string;
  }>;
}

export interface LightTableAgentAccessStatus {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly state: 'stopped' | 'starting' | 'running' | 'error';
  readonly address?: string;
  readonly port?: number;
  readonly deviceId?: string;
  readonly token?: string;
  readonly error?: string;
}

export type LightTableAgentTunnelState = 'offline' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'revoked';
export type LightTableAgentClientScope = 'read' | 'edit';
export interface LightTableAgentClient {
  readonly id: string;
  readonly name: string;
  readonly requestedScopes: readonly LightTableAgentClientScope[];
  readonly scopes: readonly LightTableAgentClientScope[];
  readonly approved: boolean;
  readonly lastActivity?: number;
}
export interface LightTableAgentTunnelEvent {
  readonly id: number; readonly at: number; readonly kind: string; readonly detail: string;
}
export interface LightTableAgentDesignActivity {
  readonly name: string; readonly status: 'running' | 'completed' | 'failed' | 'canceled';
  readonly progress: number; readonly documentId?: string; readonly taskId?: string;
  readonly results?: readonly { readonly id: string; readonly name: string; readonly mediaType: string }[];
}
export interface LightTableAgentTunnelStatus {
  readonly state: LightTableAgentTunnelState;
  readonly serverUrl?: string;
  readonly serverId?: string;
  readonly deviceId: string;
  readonly clients: readonly LightTableAgentClient[];
  readonly events: readonly LightTableAgentTunnelEvent[];
  readonly activity?: LightTableAgentDesignActivity;
  readonly lastActivity?: number;
  readonly error?: string;
}

export interface LightTableAgentAccessService {
  status(): Promise<LightTableAgentAccessStatus>;
  enable(options?: { readonly port?: number }): Promise<LightTableAgentAccessStatus>;
  disable(): Promise<LightTableAgentAccessStatus>;
  rotateCredentials(): Promise<LightTableAgentAccessStatus>;
  subscribe(listener: (status: LightTableAgentAccessStatus) => void): () => void;
  installDriver(driver: LightTableAutomationDriver): (() => void) | void;
  tunnelStatus(): Promise<LightTableAgentTunnelStatus>;
  pairServer(serverUrl: string, code: string): Promise<LightTableAgentTunnelStatus>;
  disconnectServer(): Promise<LightTableAgentTunnelStatus>;
  reconnectServer(): Promise<LightTableAgentTunnelStatus>;
  approveClient(clientId: string, scopes: readonly LightTableAgentClientScope[]): Promise<LightTableAgentTunnelStatus>;
  revokeClient(clientId: string): Promise<LightTableAgentTunnelStatus>;
  revokeDevice(): Promise<LightTableAgentTunnelStatus>;
  cancelActivity(): Promise<LightTableAgentTunnelStatus>;
  undoActivity(): Promise<LightTableAgentTunnelStatus>;
  subscribeTunnel(listener: (status: LightTableAgentTunnelStatus) => void): () => void;
}

export interface LightTableGenAiService extends GenAiHostPort {
  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void;
  subscribeJobs(
    projectId: string,
    listener: (job: import('@lighttable/genai-core').GenAiGenerationJob) => void
  ): () => void;
}

export interface LightTableHost {
  readonly kind: 'web' | 'electron' | 'storybuilder';
  readonly media?: LightTableMediaBrowser;
  readonly clipboard?: LightTableImageClipboard;
  readonly systemFontProvider?: SystemFontByteProvider;
  readonly recovery?: LightTableRecoveryStore;
  readonly recoveryLocation?: import('./LightTableRecoveryStore').LightTableRecoveryLocationService;
  readonly release?: LightTableReleaseService;
  readonly projects?: LightTableProjectService;
  readonly agentAccess?: LightTableAgentAccessService;
  readonly genAi?: LightTableGenAiService;
  readonly funnel?: LightTableFunnelTelemetry;
  listSystemFonts?(): Promise<readonly DocumentFontAsset[]>;
  openFile?(): Promise<File | null>;
  listRecentFiles?(): Promise<readonly LightTableRecentFile[]>;
  loadRecentFileThumbnail?(id: string): Promise<string | null>;
  openRecentFile?(id: string): Promise<File | null>;
  removeRecentFile?(id: string): Promise<void>;
  clearRecentFiles?(): Promise<void>;
  /** Enter or leave the host window's native/browser fullscreen presentation. */
  setFullscreen?(enabled: boolean): Promise<void>;
  /** Observe fullscreen exits initiated by the OS, browser or Escape key. */
  subscribeFullscreen?(listener: (enabled: boolean) => void): () => void;
  /**
   * Ask the host whether unsaved changes may be discarded.
   */
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  /** Persist a prepared artifact and report the host durability honestly. */
  save(request: LightTableSaveRequest): Promise<LightTableSaveResult>;
  /** Test-only host seam. Production browser hosts never install this. */
  installAutomationDriver?(driver: LightTableAutomationDriver): (() => void) | void;
}

export const createBrowserHost = (): LightTableHost => ({
  kind: 'web',
  funnel: typeof localStorage === 'undefined'
    ? undefined
    : createLocalLightTableFunnelTelemetry(localStorage),
  recovery: createBrowserRecoveryStore(),
  recoveryLocation: {
    current: async () => ({ label: 'Private browser storage (OPFS)', custom: false, canChoose: false }),
    choose: async () => null,
    reset: async () => ({ label: 'Private browser storage (OPFS)', custom: false, canChoose: false }),
    apply: async () => ({ label: 'Private browser storage (OPFS)', custom: false, canChoose: false })
  },
  clipboard: browserImageClipboard(),
  async setFullscreen(enabled) {
    if (enabled) {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  },
  subscribeFullscreen(listener) {
    const publish = () => listener(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', publish);
    return () => document.removeEventListener('fullscreenchange', publish);
  },
  async confirmDiscardChanges(documentTitle) {
    return window.confirm(`Discard unsaved changes to “${documentTitle}”?`);
  },
  async save({ file }) {
    const url = URL.createObjectURL(file);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      return { status: 'committed', durability: 'download' };
    } catch (reason) {
      return {
        status: 'failed',
        phase: 'download',
        message: reason instanceof Error ? reason.message : String(reason)
      };
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
});
