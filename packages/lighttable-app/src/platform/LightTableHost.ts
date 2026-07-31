import type { LightTableImageClipboard } from './LightTableImageClipboard';
import { browserImageClipboard } from './LightTableImageClipboard';

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
  /**
   * Ask the host whether unsaved changes may be discarded.
   */
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  /**
   * Return false when the host showed a save dialog and the user cancelled it.
   * Undefined/void means the save completed.
   */
  save(request: LightTableSaveRequest): Promise<boolean | void>;
}

export const createBrowserHost = (): LightTableHost => ({
  kind: 'web',
  clipboard: browserImageClipboard(),
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
