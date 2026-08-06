import type { LightTableImageClipboard } from './LightTableImageClipboard';
import { browserImageClipboard } from './LightTableImageClipboard';
import type { LightTableAutomationDriver } from '../lighttable/application/commands/lightTableCommandService';
import type { DocumentFontAsset } from '../lighttable/editor/document/documentTypes';
import type { SystemFontByteProvider } from '../lighttable/text/fonts/DocumentFontRegistry';
import type { LightTableRecoveryStore } from './LightTableRecoveryStore';
import { createBrowserRecoveryStore } from './BrowserRecoveryStore';

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
  thumbnailUrl?: string;
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

export interface LightTableHost {
  readonly kind: 'web' | 'electron' | 'storybuilder';
  readonly media?: LightTableMediaBrowser;
  readonly clipboard?: LightTableImageClipboard;
  readonly systemFontProvider?: SystemFontByteProvider;
  readonly recovery?: LightTableRecoveryStore;
  readonly release?: LightTableReleaseService;
  listSystemFonts?(): Promise<readonly DocumentFontAsset[]>;
  openFile?(): Promise<File | null>;
  listRecentFiles?(): Promise<readonly LightTableRecentFile[]>;
  openRecentFile?(id: string): Promise<File | null>;
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
  recovery: createBrowserRecoveryStore(),
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
