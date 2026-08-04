import type { LightTableImageClipboard } from './LightTableImageClipboard';
import { browserImageClipboard } from './LightTableImageClipboard';
import type { LightTableAutomationDriver } from '../lighttable/application/commands/lightTableCommandService';

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
}

export interface LightTableRecentFile {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export interface LightTableHost {
  readonly kind: 'web' | 'electron' | 'storybuilder';
  readonly media?: LightTableMediaBrowser;
  readonly clipboard?: LightTableImageClipboard;
  openFile?(): Promise<File | null>;
  listRecentFiles?(): Promise<readonly LightTableRecentFile[]>;
  openRecentFile?(id: string): Promise<File | null>;
  /** Enter or leave the host window's native/browser fullscreen presentation. */
  setFullscreen?(enabled: boolean): Promise<void>;
  /** Observe fullscreen exits initiated by the OS, browser or Escape key. */
  subscribeFullscreen?(listener: (enabled: boolean) => void): () => void;
  /**
   * Ask the host whether unsaved changes may be discarded.
   */
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  /**
   * Return false when the host showed a save dialog and the user cancelled it.
   * Undefined/void means the save completed.
   */
  save(request: LightTableSaveRequest): Promise<boolean | void>;
  /** Test-only host seam. Production browser hosts never install this. */
  installAutomationDriver?(driver: LightTableAutomationDriver): (() => void) | void;
}

export const createBrowserHost = (): LightTableHost => ({
  kind: 'web',
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
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
});
