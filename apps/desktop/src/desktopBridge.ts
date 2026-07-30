export interface DesktopFilePayload {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface DesktopSavePayload {
  suggestedName: string;
  bytes: Uint8Array;
}

export interface LightTableDesktopBridge {
  openFile(): Promise<DesktopFilePayload | null>;
  confirmDiscardChanges(documentTitle: string): Promise<boolean>;
  saveFile(payload: DesktopSavePayload): Promise<boolean>;
  writeClipboardPng(bytes: Uint8Array): Promise<void>;
  readClipboardPng(): Promise<Uint8Array | null>;
}
