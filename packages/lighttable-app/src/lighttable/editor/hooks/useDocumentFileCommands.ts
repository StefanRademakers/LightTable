import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject
} from 'react';
import type { DocumentCommandHistory } from '../../application/commands/documentCommandHistory';
import {
  exportLightTableDocument,
  type DocumentExportRenderer,
  type ExportedLightTableDocument,
  type ExportLightTableRuntimeOptions
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
import type { PsdExportIntent } from '../../application/documents/psdExportProtocol';
import {
  pickSupportedImageFile
} from '../../image-io/supportedImageFormats';
import type { LightTableRecipe } from '../../lightTableRecipe';
import type { BasicAdjustments } from '../../types';
import type { LightTableSaveResult } from '../../../platform/LightTableHost';
import { executeDocumentSaveTransaction } from '../../application/documents/documentSaveTransaction';
import { planSourceFormatSave } from '../../application/documents/planSourceFormatSave';
import { WasmVipsEncoder } from '../../image-io/WasmVipsEncoder';
import { nativeBitmapFormat, type NativeBitmapFormatId } from '../../image-io/nativeBitmapFormats';
import { exportSvgDocument } from '../../application/vectors/svgDocumentCodec';

export interface DocumentFileCommandsOptions {
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly advancedFileInputRef: RefObject<HTMLInputElement | null>;
  readonly taskRegistry: DocumentTaskRegistry;
  readonly commandHistory: DocumentCommandHistory;
  readonly effectiveSourceFileKey: string | null;
  readonly fileNameBase: string;
  readonly sourceFile: File | null;
  readonly hasMetadata: boolean;
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => DocumentExportRenderer | null;
  readonly getFlatAdjustments: () => BasicAdjustments;
  readonly getDocumentAdjustments: () => BasicAdjustments;
  readonly getEffectiveLayeredAdjustments: (
    document: ImageDocument
  ) => BasicAdjustments;
  readonly getGlobalGradeStrength?: () => number;
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
    recipe: LightTableRecipe | null,
    transaction: { readonly id: string; readonly documentId: string; readonly revision: number },
    replaceSource?: { readonly path: string; readonly format: NativeBitmapFormatId }
  ) => Promise<LightTableSaveResult> | LightTableSaveResult;
  readonly onExportFile?: (file: File) => Promise<unknown> | unknown;
  readonly getDocumentRevision?: () => number;
  readonly getIsDirty?: () => boolean;
  readonly commitSavedRevision?: (revision: number) => void;
  readonly onSaveCommitted?: (savedRevision: number) => Promise<void> | void;
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
  exportOutput(options?: ExportLightTableRuntimeOptions): Promise<ExportedLightTableDocument>;
  exportBitmapArtifact(format: NativeBitmapFormatId, signal?: AbortSignal): Promise<File>;
  save(): Promise<void>;
  exportPng(): Promise<void>;
  exportJpeg(): Promise<void>;
  exportWebp(): Promise<void>;
  exportTiff(): Promise<void>;
  exportPsd(): Promise<void>;
  exportPsdMaximumAppearance(): Promise<void>;
  exportSvg(): Promise<void>;
  openLocalFile(
    file: File | null,
    decodeMode: DocumentOpenMode
  ): Promise<void>;
  handleFastFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  handlePrecisionFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  chooseLocalFile(decodeMode: DocumentOpenMode): Promise<void>;
  deliverExportFile(file: File): Promise<void>;
}

const downloadOutput = (file: File): void => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

type PreparedDocumentSave = {
  readonly file: File;
  readonly recipe: LightTableRecipe | null;
  readonly replaceSource?: { readonly path: string; readonly format: NativeBitmapFormatId };
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
  const nativeBitmapEncoderRef = useRef<WasmVipsEncoder | null>(null);
  useEffect(() => () => {
    nativeBitmapEncoderRef.current?.destroy();
    nativeBitmapEncoderRef.current = null;
  }, []);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const exportOutput = useCallback(async (runtime: ExportLightTableRuntimeOptions = {}) => {
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
      globalGradeStrength: current.getGlobalGradeStrength?.() ?? 100,
      preservedSourceAssets: current.getPreservedSourceAssets(),
      fontAssets: await current.getFontAssets()
    }, runtime);
  }, []);

  const save = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.hasMetadata || !current.effectiveSourceFileKey
      || savingRef.current) return;
    if (current.getIsDirty && !current.getIsDirty()) {
      const cleanDocument = current.getDocument();
      const sourcePath = current.sourceFile
        ? (current.sourceFile as File & { readonly lightTableSourcePath?: string })
          .lightTableSourcePath
        : undefined;
      if (cleanDocument && planSourceFormatSave({
        document: cleanDocument,
        source: current.sourceFile ? {
          name: current.sourceFile.name,
          type: current.sourceFile.type,
          sourcePath
        } : null,
        flatAdjustments: current.getFlatAdjustments(),
        documentAdjustments: current.getDocumentAdjustments()
      }).kind === 'replace-source') {
        current.setStatus?.('No changes to save');
        return;
      }
    }
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
          prepare: async (): Promise<PreparedDocumentSave> => {
            const document = current.getDocument();
            const renderer = current.getRenderer();
            if (!document || !renderer) throw new Error('LightTable is not ready yet.');
            const sourcePath = current.sourceFile
              ? (current.sourceFile as File & { readonly lightTableSourcePath?: string })
                .lightTableSourcePath
              : undefined;
            const plan = planSourceFormatSave({
              document,
              source: current.sourceFile ? {
                name: current.sourceFile.name,
                type: current.sourceFile.type,
                sourcePath
              } : null,
              flatAdjustments: current.getFlatAdjustments(),
              documentAdjustments: current.getDocumentAdjustments()
            });
            if (plan.kind === 'replace-source') {
              if (!renderer.exportRgba8 || (plan.bitDepth === 16 && !renderer.exportRgba16)) {
                throw new Error('Native bitmap readback is unavailable in this renderer.');
              }
              const pixels = plan.bitDepth === 16
                ? await renderer.exportRgba16!()
                : await renderer.exportRgba8();
              nativeBitmapEncoderRef.current ??= new WasmVipsEncoder();
              const blob = await nativeBitmapEncoderRef.current.encode(pixels, plan.format, task.signal);
              return {
                file: new File([blob], plan.sourceName, { type: plan.mediaType }),
                recipe: null,
                replaceSource: { path: plan.sourcePath, format: plan.format }
              };
            }
            const output = await exportOutput();
            return {
              file: output.file,
              recipe: output.recipe
            };
          },
          buildRequest: (output) => ({
            file: output.file,
            recipe: output.recipe,
            replaceSource: output.replaceSource
          }),
          write: (request) => Promise.resolve(current.onSave(
            request.file,
            request.recipe as LightTableRecipe | null,
            request.transaction!,
            request.replaceSource
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
        await current.onSaveCommitted?.(documentRevision);
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

  const exportBitmapArtifact = useCallback(async (
    format: NativeBitmapFormatId,
    signal?: AbortSignal
  ): Promise<File> => {
    const current = optionsRef.current;
    const renderer = current.getRenderer();
    const document = current.getDocument();
    if (!renderer || !document || !current.hasMetadata) {
      throw new Error('LightTable is not ready yet.');
    }
    const definition = nativeBitmapFormat(format);
    const bitDepth = document.colorSettings.bitDepth === 16
      && definition.writableBitDepths.includes(16) ? 16 : 8;
    if (!renderer.exportRgba8 || (bitDepth === 16 && !renderer.exportRgba16)) {
      throw new Error('Native bitmap readback is unavailable in this renderer.');
    }
    const pixels = bitDepth === 16 ? await renderer.exportRgba16!() : await renderer.exportRgba8();
    nativeBitmapEncoderRef.current ??= new WasmVipsEncoder();
    const blob = await nativeBitmapEncoderRef.current.encode(pixels, format, signal);
    const base = current.fileNameBase.replace(/\.[^.]+$/, '') || 'image';
    const extension = format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tif' : format;
    return new File([blob], `${base}-lighttable.${extension}`, { type: definition.mediaType });
  }, []);

  const exportNativeBitmap = useCallback(async (
    format: NativeBitmapFormatId,
    label: string
  ) => {
    const current = optionsRef.current;
    current.setError(null);
    const result = await current.taskRegistry.run(
      'export',
      `Export ${label}`,
      async (task) => {
        const file = await exportBitmapArtifact(format, task.signal);
        task.throwIfCanceled();
        if (current.onExportFile) await current.onExportFile(file);
        else downloadOutput(file);
      }
    );
    if (result.status === 'failed') {
      current.setError(result.error.message || `${label} export failed.`);
    }
  }, [exportBitmapArtifact]);

  const exportPng = useCallback(() => exportNativeBitmap('png', 'PNG'), [exportNativeBitmap]);
  const exportJpeg = useCallback(() => exportNativeBitmap('jpeg', 'JPEG'), [exportNativeBitmap]);
  const exportWebp = useCallback(() => exportNativeBitmap('webp', 'WebP'), [exportNativeBitmap]);
  const exportTiff = useCallback(() => exportNativeBitmap('tiff', 'TIFF'), [exportNativeBitmap]);

  const exportPsdWithIntent = useCallback(async (intent: PsdExportIntent) => {
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
        const composite = await renderer.exportPng();
        const exportedAssets = intent === 'editable'
          ? await (renderer.exportPsdLayerAssets?.(imageDocument)
            ?? renderer.exportLayerAssets(imageDocument))
          : [];
        task.throwIfCanceled();
        const layerAssets = exportedAssets.filter(
          (asset): asset is LayerAssetBlobs => 'layerId' in asset
        );
        const colorLookupAssets = exportedAssets.filter(
          (asset): asset is import('../persistence/layeredDocumentFormat').ColorLookupAssetBlob => 'lutId' in asset
        );
        const exported = await exportPsdDocument(
          imageDocument,
          composite,
          layerAssets,
          colorLookupAssets,
          current.fileNameBase,
          intent
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
  const exportPsd = useCallback(
    () => exportPsdWithIntent('editable'),
    [exportPsdWithIntent]
  );
  const exportPsdMaximumAppearance = useCallback(
    () => exportPsdWithIntent('maximum-appearance'),
    [exportPsdWithIntent]
  );
  const exportSvgFile = useCallback(async () => {
    const current = optionsRef.current;
    current.setError(null);
    const result = await current.taskRegistry.run('export', 'Export SVG', async (task) => {
      const imageDocument = current.getDocument();
      if (!imageDocument || !current.hasMetadata) throw new Error('LightTable is not ready yet.');
      const file = exportSvgDocument(imageDocument, current.fileNameBase);
      task.throwIfCanceled();
      if (current.onExportFile) await current.onExportFile(file);
      else downloadOutput(file);
    });
    if (result.status === 'failed') current.setError(result.error.message || 'SVG export failed.');
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

  const deliverExportFile = useCallback(async (file: File) => {
    const current = optionsRef.current;
    if (current.onExportFile) await current.onExportFile(file);
    else downloadOutput(file);
  }, []);

  return {
    saving,
    exportOutput,
    exportBitmapArtifact,
    save,
    exportPng,
    exportJpeg,
    exportWebp,
    exportTiff,
    exportPsd,
    exportPsdMaximumAppearance,
    exportSvg: exportSvgFile,
    openLocalFile,
    handleFastFileInput: (event) => handleFileInput(event, 'fast'),
    handlePrecisionFileInput: (event) =>
      handleFileInput(event, 'preserve-precision'),
    chooseLocalFile,
    deliverExportFile
  };
};
