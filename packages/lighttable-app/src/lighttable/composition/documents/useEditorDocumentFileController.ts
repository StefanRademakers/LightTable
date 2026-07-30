import { useRef, type RefObject } from 'react';
import type { DocumentOpenMode } from '../../application/documents/documentSourceProbe';
import {
  useDocumentFileCommands,
  type DocumentFileCommands,
  type DocumentFileCommandsOptions
} from '../../editor/hooks/useDocumentFileCommands';
import { createDefaultAdjustments } from '../../types';
import type {
  EditorDocumentLifecycleController
} from './useEditorDocumentLifecycleController';

type DelegatedFileCommandOptions = Omit<
  DocumentFileCommandsOptions,
  'fileInputRef'
  | 'advancedFileInputRef'
  | 'hydrateLocalFile'
>;

export interface EditorDocumentFileControllerOptions
  extends DelegatedFileCommandOptions {
  readonly lifecycle: EditorDocumentLifecycleController;
}

export interface EditorDocumentFileController extends DocumentFileCommands {
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly advancedFileInputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Composes the file-command adapter for one document runtime.
 *
 * The application file commands own task lifetime, export and host dispatch.
 * This boundary owns the editor-only file inputs and translates a selected
 * host file into the same atomic source lifecycle used during startup. Web and
 * Electron therefore share one open/save/export path without teaching either
 * the editor root or its shell about codecs and renderer hydration.
 */
export const useEditorDocumentFileController = ({
  lifecycle,
  ...options
}: EditorDocumentFileControllerOptions): EditorDocumentFileController => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const advancedFileInputRef = useRef<HTMLInputElement | null>(null);
  const commands = useDocumentFileCommands({
    ...options,
    fileInputRef,
    advancedFileInputRef,
    hydrateLocalFile: async (
      file,
      decodeMode: DocumentOpenMode,
      signal,
      isCurrent
    ) => {
      await lifecycle.loadSource({
        blob: file,
        name: file.name,
        initialAdjustments: createDefaultAdjustments(),
        identity: [
          file.name,
          file.type,
          file.lastModified,
          decodeMode === 'preserve-precision' ? 'preserve-precision' : ''
        ].filter(Boolean).join(':'),
        isCanceled: () => !isCurrent(),
        decodeMode,
        signal
      });
    }
  });

  return {
    ...commands,
    fileInputRef,
    advancedFileInputRef
  };
};
