import type {
  DocumentOpenMode
} from '../lighttable/application/documents/documentSourceProbe';
import type { DocumentCreationSettings } from '../lighttable/editor/document/documentTypes';
import type { DocumentStartupTimeline } from '../lighttable/application/telemetry/documentStartupTimeline';

export type StandaloneDecodeMode = DocumentOpenMode;

export interface StandaloneDocumentRuntime {
  readonly kind: 'image';
  readonly file: File;
  readonly decodeMode: StandaloneDecodeMode;
  readonly creationSettings?: DocumentCreationSettings;
  readonly startupTimeline: DocumentStartupTimeline;
  readonly recovery?: {
    readonly recoveryId: string;
    readonly originalName: string;
    readonly crashLoop: boolean;
  };
}

export const standaloneSourceIdentity = (
  file: File,
  _decodeMode: StandaloneDecodeMode
) => {
  const sourcePath = (file as File & { readonly lightTableSourcePath?: string }).lightTableSourcePath;
  if (sourcePath) {
    const canonicalPath = sourcePath.replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('en-US');
    return `path:${canonicalPath}`;
  }
  return `file:${file.name}:${file.size}:${file.lastModified}`;
};
