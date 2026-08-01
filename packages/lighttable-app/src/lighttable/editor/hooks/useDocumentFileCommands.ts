import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject
} from 'react';
import type { DocumentCommandHistory } from '../../application/commands/documentCommandHistory';
import {
  buildLightTableOutputName,
  exportLightTableDocument,
  type DocumentExportRenderer,
  type ExportedLightTableDocument
} from '../../application/documents/exportLightTableDocument';
import type { DocumentTaskRegistry } from '../../application/tasks/documentTaskRegistry';
import type {
  DocumentOpenMode
} from '../../application/documents/documentSourceProbe';
import type { ImageDocument } from '../document/documentTypes';
import type { PreservedSourceAssetBlob } from '../persistence/layeredDocumentFormat';
import {
  pickSupportedImageFile
} from '../../image-io/supportedImageFormats';
import type { LightTableRecipe } from '../../lightTableRecipe';
import type { BasicAdjustments } from '../../types';

export interface DocumentFileCommandsOptions {
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly advancedFileInputRef: RefObject<HTMLInputElement | null>;
  readonly taskRegistry: DocumentTaskRegistry;
  readonly commandHistory: DocumentCommandHistory;
  readonly effectiveSourceFileKey: string | null;
  readonly fileNameBase: string;
  readonly hasMetadata: boolean;
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => DocumentExportRenderer | null;
  readonly getFlatAdjustments: () => BasicAdjustments;
  readonly getDocumentAdjustments: () => BasicAdjustments;
  readonly getEffectiveLayeredAdjustments: (
    document: ImageDocument
  ) => BasicAdjustments;
  readonly getPreservedSourceAssets: () => readonly PreservedSourceAssetBlob[];
  readonly hydrateLocalFile: (
    file: File,
    decodeMode: DocumentOpenMode,
    signal: AbortSignal,
    isCurrent: () => boolean
  ) => Promise<void>;
  readonly cancelAutoAlign: () => void;
  readonly onSave: (
    file: File,
    recipe: LightTableRecipe
  ) => Promise<boolean | void> | boolean | void;
  readonly onClose: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onRequestOpenWorkspaceDocument?: (
    decodeMode: DocumentOpenMode
  ) => Promise<void> | void;
  readonly onOpenWorkspaceDocument?: (
    file: File,
    decodeMode: DocumentOpenMode
  ) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string | null) => void;
}

export interface DocumentFileCommands {
  readonly saving: boolean;
  exportOutput(): Promise<ExportedLightTableDocument>;
  save(): Promise<void>;
  exportPng(): Promise<void>;
  openLocalFile(
    file: File | null,
    decodeMode: DocumentOpenMode
  ): Promise<void>;
  handleFastFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  handlePrecisionFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  chooseLocalFile(decodeMode: DocumentOpenMode): Promise<void>;
}

const downloadOutput = (file: File): void => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Owns File-menu orchestration for one document view.
 *
 * Canonical export remains in the application service. This hook only binds
 * task lifetime, host file picking/download behavior and presentation status.
 */
export const useDocumentFileCommands = (
  options: DocumentFileCommandsOptions
): DocumentFileCommands => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const exportOutput = useCallback(async () => {
    const current = optionsRef.current;
    const renderer = current.getRenderer();
    if (!renderer) throw new Error('LightTable is not ready yet.');
    const imageDocument = current.getDocument();
    if (!imageDocument || !current.effectiveSourceFileKey) {
      throw new Error('The LightTable document is not ready yet.');
    }
    return exportLightTableDocument({
      document: imageDocument,
      renderer,
      recipeSourceKey: current.effectiveSourceFileKey,
      fileNameBase: current.fileNameBase,
      flatAdjustments: current.getFlatAdjustments(),
      documentAdjustments: current.getDocumentAdjustments(),
      effectiveLayeredAdjustments:
        current.getEffectiveLayeredAdjustments(imageDocument),
      preservedSourceAssets: current.getPreservedSourceAssets()
    });
  }, []);

  const save = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.hasMetadata || !current.effectiveSourceFileKey
      || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    current.setError(null);
    const result = await current.taskRegistry.run(
      'save',
      'Save document',
      async (task) => {
        const output = await exportOutput();
        task.throwIfCanceled();
        const saved = await current.onSave(output.file, output.recipe);
        task.throwIfCanceled();
        if (saved !== false) {
          current.commandHistory.markSaved();
          current.onDirtyChange?.(false);
          current.onClose();
        }
        return saved;
      }
    );
    if (result.status === 'failed') {
      current.setError(
        result.error.message || 'LightTable image could not be saved.'
      );
    }
    savingRef.current = false;
    setSaving(false);
  }, [exportOutput]);

  const exportPng = useCallback(async () => {
    const current = optionsRef.current;
    current.setError(null);
    const result = await current.taskRegistry.run(
      'export',
      'Export PNG',
      async (task) => {
        const renderer = current.getRenderer();
        if (!renderer || !current.hasMetadata) {
          throw new Error('LightTable is not ready yet.');
        }
        const blob = await renderer.exportPng();
        task.throwIfCanceled();
        downloadOutput(new File(
          [blob],
          buildLightTableOutputName(current.fileNameBase),
          { type: 'image/png' }
        ));
      }
    );
    if (result.status === 'failed') {
      current.setError(result.error.message || 'LightTable export failed.');
    }
  }, []);

  const openLocalFile = useCallback(async (
    file: File | null,
    decodeMode: DocumentOpenMode
  ) => {
    if (!file) return;
    const current = optionsRef.current;
    current.cancelAutoAlign();
    current.setLoading(true);
    current.setError(null);
    const result = await current.taskRegistry.run(
      'open',
      'Open image',
      async (task) => {
        await current.hydrateLocalFile(
          file,
          decodeMode,
          task.signal,
          () => task.isCurrent()
        );
        task.throwIfCanceled();
      }
    );
    if (result.status === 'failed') {
      current.setError(
        result.error.message
        || (decodeMode === 'preserve-precision'
          ? 'The precision-preserving image import failed.'
          : 'The image could not be opened.')
      );
    }
    if (result.status !== 'canceled'
      || current.taskRegistry.getSnapshot().activeTaskIds.length === 0) {
      current.setLoading(false);
    }
  }, []);

  const handleFileInput = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
    decodeMode: DocumentOpenMode
  ) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    await openLocalFile(file, decodeMode);
  }, [openLocalFile]);

  const chooseLocalFile = useCallback(async (
    decodeMode: DocumentOpenMode
  ) => {
    const current = optionsRef.current;
    try {
      current.setError(null);
      if (current.onRequestOpenWorkspaceDocument) {
        await current.onRequestOpenWorkspaceDocument(decodeMode);
        return;
      }
      const fallback = decodeMode === 'preserve-precision'
        ? current.advancedFileInputRef.current
        : current.fileInputRef.current;
      const file = await pickSupportedImageFile(
        decodeMode === 'preserve-precision' ? decodeMode : 'fast',
        fallback
      );
      if (!file) return;
      if (current.onOpenWorkspaceDocument) {
        current.onOpenWorkspaceDocument(file, decodeMode);
        return;
      }
      await openLocalFile(file, decodeMode);
    } catch (reason) {
      current.setError(
        reason instanceof Error
          ? reason.message
          : 'The image file dialog could not be opened.'
      );
    }
  }, [openLocalFile]);

  return {
    saving,
    exportOutput,
    save,
    exportPng,
    openLocalFile,
    handleFastFileInput: (event) => handleFileInput(event, 'fast'),
    handlePrecisionFileInput: (event) =>
      handleFileInput(event, 'preserve-precision'),
    chooseLocalFile
  };
};
