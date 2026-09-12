import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { RasterSelectionMask, SmartSelectionOptions } from '../../../editor/selection/selectionTypes';
import type { DocumentProcessingState } from '../../documents/documentSession';
import type { SemanticSubjectSelectionCommand } from '../../commands/semanticSubjectSelectionCommandContract';
import type { PreparedSmartSelectionSource, SmartSelectionBackend, SmartSelectionBackendIdentity,
  SmartSelectionPreparationState, SmartSelectionPrompt, SmartSelectionRequestOptions, SmartSelectionSource } from './SmartSelectionBackend';
import { SmartSelectionRequestGate } from './SmartSelectionRequestGate';
import { createSmartSelectionSource, type SmartSelectionSourceRenderer } from './smartSelectionSource';
import { traceSmartSelection } from './smartSelectionTrace';

export interface SmartSelectionSourcePorts {
  captureScope(): { isCurrent(): boolean };
  getDocument(): ImageDocument | null;
  getProcessing(): DocumentProcessingState | null;
  getRenderer(): SmartSelectionSourceRenderer | null;
  isRendererReady(): boolean;
  getOptions(): SmartSelectionOptions;
  setStatus(message: string | null): void;
  onBackendIdentityChange?(identity: SmartSelectionBackendIdentity): void;
  onPreparationChange?(state: SmartSelectionPreparationState): void;
}

export const smartSelectionProcessingEqual = (left: DocumentProcessingState | null,
  right: DocumentProcessingState | null) => left?.adjustments === right?.adjustments
  && left?.groupVisibility === right?.groupVisibility
  && left?.globalGradeStrength === right?.globalGradeStrength;

/** Source/inference authority only: no pointer, preview, selection or history writes. */
export class SmartSelectionSourceSession {
  private readonly gate: SmartSelectionRequestGate;
  private source: SmartSelectionSource | null = null;
  private sourceIsOwned: (() => boolean) | null = null;
  private preparing: { key: string; promise: Promise<boolean>; isCurrent(): boolean } | null = null;
  private epoch = 0;
  private sequence = 0;
  private disposed = false;
  private processing: DocumentProcessingState | null = null;
  private processingGeneration = 0;
  private readonly unsubscribe: (() => void) | null;

  constructor(private readonly ports: SmartSelectionSourcePorts, private readonly backend: SmartSelectionBackend) {
    this.gate = new SmartSelectionRequestGate(backend);
    this.unsubscribe = backend.subscribeStatus?.(status => {
      if (this.disposed || !this.preparing?.isCurrent()) return;
      ports.setStatus(status.message);
      if (!this.source) ports.onPreparationChange?.({ phase: 'preparing', message: status.message,
        ...(status.progress === undefined ? {} : { progress: status.progress }) });
    }) ?? null;
  }

  /** Immutable canonical references, not a second processing value or the session clock. */
  private readProcessingGeneration() {
    const current = this.ports.getProcessing();
    if (!smartSelectionProcessingEqual(current, this.processing)) {
      this.processingGeneration += 1;
    }
    this.processing = current;
    return this.processingGeneration;
  }

  captureRequest(signal?: AbortSignal, followActiveLayer = false) {
    const epoch = this.epoch;
    const scope = this.ports.captureScope();
    const opening = this.ports.getDocument();
    const documentId = opening?.id;
    const revision = opening?.revision;
    const layerId = opening?.activeLayerId;
    const processing = this.readProcessingGeneration();
    const sampleAllLayers = followActiveLayer && this.ports.getOptions().sampleAllLayers;
    return () => {
      if (this.disposed || epoch !== this.epoch || signal?.aborted || !scope.isCurrent()) return false;
      const current = this.ports.getDocument();
      return current?.id === documentId && current?.revision === revision
        && this.readProcessingGeneration() === processing
        && (!followActiveLayer || (current?.activeLayerId === layerId
          && this.ports.getOptions().sampleAllLayers === sampleAllLayers));
    };
  }

  private key(document: ImageDocument, sampleAllLayers: boolean, layerId: LayerId | null) {
    return [document.id, document.revision, sampleAllLayers ? 'composite' : layerId,
      `processing-${this.readProcessingGeneration()}`].join(':');
  }

  prepareCurrent() {
    const document = this.ports.getDocument();
    return this.prepare(document?.activeLayerId ?? null, this.ports.getOptions().sampleAllLayers, true);
  }

  async prepare(sourceLayerId: LayerId | null, sampleAllLayers: boolean,
    followActiveLayer: boolean, signal?: AbortSignal) {
    const scopeIsCurrent = this.captureRequest(undefined, followActiveLayer);
    const requestIsCurrent = () => scopeIsCurrent() && !signal?.aborted;
    const document = this.ports.getDocument();
    const renderer = this.ports.getRenderer();
    const rendererReady = this.ports.isRendererReady();
    if (!document || !renderer || !rendererReady || !requestIsCurrent()) {
      traceSmartSelection('prepare-rejected', { document: Boolean(document), renderer: Boolean(renderer),
        rendererReady, disposed: this.disposed });
      return false;
    }
    const expectedKey = this.key(document, sampleAllLayers, sourceLayerId);
    if (this.source?.key === expectedKey && this.sourceIsOwned?.()) {
      this.ports.onPreparationChange?.({ phase: 'ready' });
      return true;
    }
    if (this.source && !this.sourceIsOwned?.()) {
      this.source = null;
      this.sourceIsOwned = null;
      this.gate.invalidate();
    }
    if (this.preparing?.key === expectedKey && this.preparing.isCurrent()) return this.preparing.promise;
    const sequence = ++this.sequence;
    const ownsSource = () => {
      if (!scopeIsCurrent() || sequence !== this.sequence) return false;
      const current = this.ports.getDocument();
      return Boolean(current && this.key(current, sampleAllLayers,
        followActiveLayer ? current.activeLayerId : sourceLayerId) === expectedKey)
        && (!followActiveLayer || this.ports.getOptions().sampleAllLayers === sampleAllLayers);
    };
    const isCurrent = () => requestIsCurrent() && ownsSource();
    const promise = (async () => {
      this.ports.setStatus('Loading Object Selection model…');
      this.ports.onPreparationChange?.({ phase: 'preparing', message: 'Loading Object Selection model…' });
      const source = await createSmartSelectionSource(expectedKey, document, renderer, sampleAllLayers, sourceLayerId);
      if (!isCurrent()) return false;
      signal?.throwIfAborted();
      const prepared = await this.gate.prepare(source, signal);
      if (!prepared || !isCurrent()) return false;
      this.ports.onBackendIdentityChange?.(this.backend.identity);
      this.source = source;
      this.sourceIsOwned = ownsSource;
      traceSmartSelection('prepared', { source: source.key });
      this.ports.setStatus(null);
      this.ports.onPreparationChange?.({ phase: 'ready' });
      return true;
    })().catch((reason: unknown) => {
      if (isCurrent()) {
        const message = reason instanceof Error
          ? `Object Selection is unavailable: ${reason.message}` : 'Object Selection is unavailable.';
        this.ports.setStatus(message);
        this.ports.onPreparationChange?.({ phase: 'error', message });
      }
      return false;
    }).finally(() => {
      if (this.preparing?.promise === promise) this.preparing = null;
    });
    this.preparing = { key: expectedKey, promise, isCurrent };
    return promise;
  }

  prepared(signal?: AbortSignal) {
    return this.source && this.sourceIsOwned?.()
      ? this.gate.prepare(this.source, signal) : Promise.resolve(null);
  }
  prompt(source: PreparedSmartSelectionSource, prompt: SmartSelectionPrompt, options: SmartSelectionRequestOptions) {
    return this.gate.prompt(source, prompt, options);
  }
  subject(source: PreparedSmartSelectionSource, options: SmartSelectionRequestOptions) {
    return this.gate.subject(source, options);
  }
  supersede() { this.gate.supersede(); }

  matches(mask: RasterSelectionMask, command: SemanticSubjectSelectionCommand | null) {
    const document = this.ports.getDocument();
    if (!document || !this.source || !this.sourceIsOwned?.()) return false;
    return this.source.key === this.key(document,
      command?.sampleAllLayers ?? this.ports.getOptions().sampleAllLayers,
      command?.sourceLayerId ?? document.activeLayerId)
      && this.source.documentRevision === document.revision
      && mask.width === document.width && mask.height === document.height;
  }

  invalidate() {
    this.epoch += 1;
    this.preparing = null;
    this.source = null;
    this.sourceIsOwned = null;
    this.gate.invalidate();
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.invalidate();
    this.gate.dispose();
    this.processing = null;
  }
}
