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
import type {
  FontAssetBlob,
  LayerAssetBlobs,
  PreservedSourceAssetBlob
} from '../persistence/layeredDocumentFormat';
import { exportPsdDocument } from '../../application/documents/PsdExportClient';
import {
  pickSupportedImageFile
} from '../../image-io/supportedImageFormats';
import type { LightTableRecipe } from '../../lightTableRecipe';
import type { BasicAdjustments } from '../../types';
import type { LightTableSaveResult } from '../../../platform/LightTableHost';
import { executeDocumentSaveTransaction } from '../../application/documents/documentSaveTransaction';

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
  readonly getFontAssets: () => Promise<readonly FontAssetBlob[]> | readonly FontAssetBlob[];
  readonly hydrateLocalFile: (
    file: File,
    decodeMode: DocumentOpenMode,
    signal: AbortSignal,
    isCurrent: () => boolean
  ) => Promise<void>;
  readonly cancelAutoAlign: () => void;
  readonly onSave: (
    file: File,
    recipe: LightTableRecipe,
    transaction: { readonly id: string; readonly documentId: string; readonly revision: number }
  ) => Promise<LightTableSaveResult> | LightTableSaveResult;
  readonly onExportFile?: (file: File) => Promise<unknown> | unknown;
  readonly getDocumentRevision?: () => number;
  readonly commitSavedRevision?: (revision: number) => void;
  readonly onSaveCommitted?: () => Promise<void> | void;
  readonly onRequestOpenWorkspaceDocument?: (
    decodeMode: DocumentOpenMode
  ) => Promise<void> | void;
  readonly onOpenWorkspaceDocument?: (
    file: File,
    decodeMode: DocumentOpenMode
  ) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly setStatus?: (status: string | null) => void;
}

export interface DocumentFileCommands {
  readonly saving: boolean;
  exportOutput(): Promise<ExportedLightTableDocument>;
  save(): Promise<void>;
  exportPng(): Promise<void>;
  exportPsd(): Promise<void>;
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
      preservedSourceAssets: current.getPreservedSourceAssets(),
      fontAssets: await current.getFontAssets()
    });
  }, []);

  const save = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.hasMetadata || !current.effectiveSourceFileKey
      || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    current.setError(null);
    current.setStatus?.('Saving…');
    const historyRevision = current.commandHistory.getSnapshot().currentStateId;
    const documentRevision = current.getDocumentRevision?.() ?? historyRevision;
    const transactionId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await current.taskRegistry.run(
      'save',
      'Save document',
      async (task) => {
        return executeDocumentSaveTransaction({
          id: transactionId,
          documentId: String(current.commandHistory.documentId),
          revision: documentRevision,
          signal: task.signal,
          isCurrent: () => task.isCurrent()
            && current.commandHistory.getSnapshot().currentStateId === historyRevision
            && (current.getDocumentRevision?.() ?? historyRevision) === documentRevision,
          prepare: exportOutput,
          buildRequest: (output) => ({ file: output.file, recipe: output.recipe }),
          write: (request) => Promise.resolve(current.onSave(
            request.file,
            request.recipe as LightTableRecipe,
            request.transaction!
          )),
          commit: () => {
            if (current.commitSavedRevision) current.commitSavedRevision(documentRevision);
            else current.commandHistory.markSaved();
          }
        });
      }
    );
    if (result.status === 'failed') {
      current.setError(
        result.error.message || 'LightTable image could not be saved.'
      );
      current.setStatus?.('Save failed');
    } else if (result.status === 'canceled') {
      current.setStatus?.('Save canceled');
    } else if (result.value.status === 'failed') {
      const phase = result.value.phase ?? 'unknown';
      current.setError(`Save failed during ${phase}: ${result.value.message ?? 'Unknown error'}`);
      current.setStatus?.('Save failed');
    } else if (result.value.status === 'canceled') {
      current.setStatus?.('Save canceled');
    } else if (result.value.markedClean) {
      try {
        await current.onSaveCommitted?.();
      } catch (reason) {
        console.warn('[Recovery] Saved document cleanup failed.', reason);
      }
      current.setStatus?.('Saved');
    } else {
      current.setStatus?.('Saved revision; newer edits remain unsaved');
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

  const exportPsd = useCallback(async () => {
    const current = optionsRef.current;
    current.setError(null);
    const result = await current.taskRegistry.run(
      'export',
      'Export Photoshop document',
      async (task) => {
        const renderer = current.getRenderer();
        const imageDocument = current.getDocument();
        if (!renderer || !imageDocument || !current.hasMetadata) {
          throw new Error('LightTable is not ready yet.');
        }
        const [composite, exportedAssets] = await Promise.all([
          renderer.exportPng(),
          renderer.exportPsdLayerAssets?.(imageDocument)
            ?? renderer.exportLayerAssets(imageDocument)
        ]);
        task.throwIfCanceled();
        const layerAssets = exportedAssets.filter(
          (asset): asset is LayerAssetBlobs => 'layerId' in asset
        );
        const exported = await exportPsdDocument(
          imageDocument,
          composite,
          layerAssets,
          current.fileNameBase
        );
        task.throwIfCanceled();
        if (current.onExportFile) await current.onExportFile(exported.file);
        else downloadOutput(exported.file);
        if (exported.warnings.length) {
          console.warn('[PSD export compatibility]', ...exported.warnings);
        }
      }
    );
    if (result.status === 'failed') {
      current.setError(result.error.message || 'Photoshop export failed.');
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
    exportPsd,
    openLocalFile,
    handleFastFileInput: (event) => handleFileInput(event, 'fast'),
    handlePrecisionFileInput: (event) =>
      handleFileInput(event, 'preserve-precision'),
    chooseLocalFile
  };
};
