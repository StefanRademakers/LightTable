export type StandaloneDecodeMode = 'fast' | 'preserve-precision';

export interface StandaloneDocumentRuntime {
  readonly file: File;
  readonly decodeMode: StandaloneDecodeMode;
}

export const standaloneSourceIdentity = (
  file: File,
  decodeMode: StandaloneDecodeMode
) => `file:${file.name}:${file.size}:${file.lastModified}:${decodeMode}`;

