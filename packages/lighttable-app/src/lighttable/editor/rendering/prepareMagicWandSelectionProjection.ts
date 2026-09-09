import type {
  CommittedSelectionState,
  DocumentAddress,
  TransactionId,
} from '@lighttable/editor-kernel';
import type { ImageDocument } from '../document/documentTypes';
import { findDocumentLayer } from '../document/layerTree';
import type { SelectionMaskSnapshot } from '../selection/SelectionMaskSnapshot';
import type { SelectionCombineMode, SelectionOperation } from '../selection/selectionTypes';
import type { SelectionMagicWandProjectionIntent } from './SelectionShapeProjectionService';
import type { LayerDocumentRenderer } from './LayerDocumentRenderer';
import { runGpuDeviceErrorScopeTransaction } from '@lighttable/webgpu-runtime';

interface MagicWandTraceEntry {
  readonly encodeMs: number;
  readonly gpuCompleteMs: number;
  readonly width: number;
  readonly height: number;
  readonly contiguous: boolean;
  readonly sampleAllLayers: boolean;
  readonly mode: SelectionCombineMode;
}

interface PrepareMagicWandSelectionProjectionOptions {
  readonly device: GPUDevice;
  readonly renderer: LayerDocumentRenderer;
  readonly document: ImageDocument;
  readonly documentAddress: DocumentAddress;
  readonly baseline: CommittedSelectionState<SelectionMaskSnapshot, SelectionOperation>;
  readonly intent: SelectionMagicWandProjectionIntent;
  readonly transactionId: TransactionId;
  readonly signal: AbortSignal;
  readonly resolveCompositeSource: () => Promise<GPUTexture | null>;
  readonly reportValidationError: (message: string) => void;
}

const traceTarget = () => (
  globalThis as typeof globalThis & {
    __LIGHTTABLE_MAGIC_WAND_TRACE__?: MagicWandTraceEntry[];
  }
).__LIGHTTABLE_MAGIC_WAND_TRACE__;

/** Owns Magic Wand source acquisition, GPU validation, telemetry and terminal release. */
export const prepareMagicWandSelectionProjection = async ({
  device, renderer, document, documentAddress, baseline, intent, transactionId,
  signal, resolveCompositeSource, reportValidationError,
}: PrepareMagicWandSelectionProjectionOptions) => {
  const sourceOperation = intent.provenance.source;
  if (sourceOperation?.kind !== 'magic-wand'
    || sourceOperation.documentRevision !== document.revision
    || sourceOperation.layerId !== intent.layerId
    || !findDocumentLayer(document, intent.layerId)) {
    throw new Error('The Magic Wand source is no longer current.');
  }
  signal.throwIfAborted();
  await renderer.prepareMagicWandTool();
  signal.throwIfAborted();
  const trace = traceTarget();
  const startedAt = trace ? performance.now() : 0;
  try {
    const transaction = await runGpuDeviceErrorScopeTransaction(
      device,
      ['validation'],
      async () => {
        const source = intent.options.sampleAllLayers
          ? await resolveCompositeSource()
          : renderer.createMagicWandSourceForActiveLayer(document, intent.layerId);
        signal.throwIfAborted();
        if (!source) throw new Error('The Magic Wand source could not be rendered.');
        const encodedAt = trace ? performance.now() : 0;
        const prepared = await renderer.prepareSelectionMagicWandProjection(
          documentAddress, baseline, intent, source, transactionId, signal,
        );
        return { prepared, encodedAt };
      }
    );
    const { prepared, encodedAt } = transaction.value;
    const validationError = transaction.errors.get('validation') ?? null;
    if (validationError) {
      prepared.dispose();
      const message = `LightTable Magic Wand validation failed: ${validationError.message}`;
      reportValidationError(message);
      throw new Error(message);
    }
    trace?.push({
      encodeMs: encodedAt - startedAt,
      gpuCompleteMs: performance.now() - startedAt,
      width: document.width,
      height: document.height,
      contiguous: intent.options.contiguous,
      sampleAllLayers: intent.options.sampleAllLayers,
      mode: intent.mode,
    });
    return prepared;
  } finally {
    renderer.releaseSubmittedResources();
  }
};
