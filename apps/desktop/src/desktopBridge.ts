export interface DesktopFilePayload {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface DesktopSavePayload {
  suggestedName: string;
  bytes: Uint8Array;
}

export interface DesktopRecentFile {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
}

export interface LightTableDesktopBridge {
  readonly automationEnabled: boolean;
  openFile(): Promise<DesktopFilePayload | null>;
  listRecentFiles(): Promise<readonly DesktopRecentFile[]>;
  openRecentFile(id: string): Promise<DesktopFilePayload | null>;
  setFullscreen(enabled: boolean): Promise<void>;
  onFullscreenChange(listener: (enabled: boolean) => void): () => void;
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  saveFile(payload: DesktopSavePayload): Promise<boolean>;
  writeClipboardPng(bytes: Uint8Array): Promise<void>;
  readClipboardPng(): Promise<Uint8Array | null>;
}
