import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type {
  RasterSelectionMask,
  SelectionCombineMode,
  SelectionPoint,
  SelectionShape,
  SmartSelectionOptions
} from '../../../editor/selection/selectionTypes';
import type { SelectionSessionController } from '../selection/useSelectionSessionController';
import type {
  SmartSelectionBackend,
  SmartSelectionBackendIdentity,
  SmartSelectionCandidate,
  SmartSelectionPreparationState,
  SmartSelectionPrompt,
  SmartSelectionSource
} from './SmartSelectionBackend';
import { BalancedSmartSelectionBackend } from './BalancedSmartSelectionBackend';
import { SmartSelectionRequestGate } from './SmartSelectionRequestGate';
import {
  createSmartSelectionSource,
  type SmartSelectionSourceRenderer
} from './smartSelectionSource';
import type {
  SemanticSubjectSelectionCommand,
  SemanticSubjectSelectionResult
} from '../../commands/semanticSubjectSelectionCommandContract';

export interface SmartSelectionPreviewRenderer extends SmartSelectionSourceRenderer {
  setSmartSelectionPreview(mask: RasterSelectionMask | null): void;
}

export interface SmartSelectionToolCallbacks {
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => SmartSelectionPreviewRenderer | null;
  readonly isRendererReady: () => boolean;
  readonly getOptions: () => SmartSelectionOptions;
  readonly selection: SelectionSessionController;
  readonly setStatus: (message: string | null) => void;
  readonly setDraft: (shape: SelectionShape | null) => void;
  readonly onBackendIdentityChange?: (identity: SmartSelectionBackendIdentity) => void;
  readonly onPreparationChange?: (state: SmartSelectionPreparationState) => void;
  readonly onSelectionCommitted?: (
    command: SemanticSubjectSelectionCommand,
    result: SemanticSubjectSelectionResult
  ) => boolean | void;
}

const candidateAtPoint = (
  candidate: SmartSelectionCandidate | null,
  point: SelectionPoint
) => {
  if (!candidate) return false;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= candidate.mask.width || y >= candidate.mask.height) return false;
  return (candidate.mask.data[y * candidate.mask.width + x] ?? 0) >= 24;
};

const bestCandidate = (candidates: readonly SmartSelectionCandidate[]) =>
  candidates.reduce<SmartSelectionCandidate | null>(
    (best, candidate) => !best || candidate.score > best.score ? candidate : best,
    null
  );

const maskCoverageSummary = (mask: RasterSelectionMask) => {
  let empty = 0;
  let soft = 0;
  let opaque = 0;
  let selectedTotal = 0;
  let selectedCount = 0;
  for (const value of mask.data) {
    if (value <= 2) empty += 1;
    else if (value >= 253) opaque += 1;
    else soft += 1;
    if (value >= 128) {
      selectedTotal += value;
      selectedCount += 1;
    }
  }
  const pixels = Math.max(1, mask.data.length);
  return {
    emptyRatio: empty / pixels,
    softRatio: soft / pixels,
    opaqueRatio: opaque / pixels,
    selectedMean: selectedCount ? selectedTotal / selectedCount / 255 : 0
  };
};

const traceSmartSelection = (event: string, detail?: Record<string, unknown>) => {
  const target = (
    globalThis as typeof globalThis & {
      __LIGHTTABLE_SMART_SELECTION_TRACE__?: Array<{
        event: string;
        detail?: Record<string, unknown>;
      }>;
    }
  ).__LIGHTTABLE_SMART_SELECTION_TRACE__;
  target?.push({ event, detail });
};

/** Owns transient async Object Selection interaction, never document state. */
export class SmartSelectionToolController {
  private readonly gate: SmartSelectionRequestGate;
  private readonly backend: SmartSelectionBackend;
  private source: SmartSelectionSource | null = null;
  private preparing: { key: string; promise: Promise<boolean> } | null = null;
  private preview: SmartSelectionCandidate | null = null;
  private pendingHoverPoint: SelectionPoint | null = null;
  private hoverInferenceActive = false;
  private selectionInferenceCount = 0;
  private region: {
    pointerId: number;
    kind: 'rectangle' | 'free';
    points: SelectionPoint[];
    mode: SelectionCombineMode;
  } | null = null;
  private disposed = false;
  private readonly unsubscribeBackendStatus: (() => void) | null;

  constructor(
    private readonly callbacks: SmartSelectionToolCallbacks,
    backend: SmartSelectionBackend = new BalancedSmartSelectionBackend()
  ) {
    this.backend = backend;
    this.gate = new SmartSelectionRequestGate(backend);
    this.unsubscribeBackendStatus = backend.subscribeStatus?.((status) => {
      if (this.disposed) return;
      this.callbacks.setStatus(status.message);
      if (!this.source) this.callbacks.onPreparationChange?.({
        phase: 'preparing',
        message: status.message,
        ...(status.progress === undefined ? {} : { progress: status.progress })
      });
    }) ?? null;
  }

  async prepare() {
    const document = this.callbacks.getDocument();
    const options = this.callbacks.getOptions();
    return this.prepareSource(document?.activeLayerId ?? null, options.sampleAllLayers, true);
  }

  private async prepareSource(
    sourceLayerId: LayerId | null,
    sampleAllLayers: boolean,
    followActiveLayer: boolean,
    signal?: AbortSignal
  ) {
    const document = this.callbacks.getDocument();
    const renderer = this.callbacks.getRenderer();
    const rendererReady = this.callbacks.isRendererReady();
    if (!document || !renderer || !rendererReady || this.disposed) {
      traceSmartSelection('prepare-rejected', {
        document: Boolean(document), renderer: Boolean(renderer), rendererReady,
        disposed: this.disposed
      });
      return false;
    }
    const expectedKey = [
      document.id,
      document.revision,
      sampleAllLayers ? 'composite' : sourceLayerId
    ].join(':');
    if (this.source?.key === expectedKey) {
      this.callbacks.onPreparationChange?.({ phase: 'ready' });
      return true;
    }
    if (this.preparing?.key === expectedKey) return this.preparing.promise;
    const promise = (async () => {
      this.callbacks.setStatus('Loading Object Selection model…');
      this.callbacks.onPreparationChange?.({
        phase: 'preparing', message: 'Loading Object Selection model…'
      });
      const source = await createSmartSelectionSource(document, renderer, sampleAllLayers, sourceLayerId);
      const current = this.callbacks.getDocument();
      const currentOptions = this.callbacks.getOptions();
      const currentKey = current ? [
        current.id,
        current.revision,
        sampleAllLayers ? 'composite' : followActiveLayer ? current.activeLayerId : sourceLayerId
      ].join(':') : null;
      if (this.disposed || !current || current.id !== document.id
        || current.revision !== source.documentRevision || currentKey !== expectedKey
        || (followActiveLayer && currentOptions.sampleAllLayers !== sampleAllLayers)) return false;
      signal?.throwIfAborted();
      const prepared = await this.gate.prepare(source, signal);
      if (!prepared || this.disposed) return false;
      this.publishBackendIdentity();
      this.source = source;
      traceSmartSelection('prepared', { source: source.key });
      this.callbacks.setStatus(null);
      this.callbacks.onPreparationChange?.({ phase: 'ready' });
      return true;
    })().catch((reason: unknown) => {
      if (!this.disposed) {
        const message = reason instanceof Error
          ? `Object Selection is unavailable: ${reason.message}`
          : 'Object Selection is unavailable.';
        this.callbacks.setStatus(message);
        this.callbacks.onPreparationChange?.({ phase: 'error', message });
      }
      return false;
    }).finally(() => {
      if (this.preparing?.key === expectedKey) this.preparing = null;
    });
    this.preparing = { key: expectedKey, promise };
    return promise;
  }

  async executeSubjectSelection(
    command: SemanticSubjectSelectionCommand,
    signal: AbortSignal,
    report: (progress: number, message: string) => void
  ): Promise<SemanticSubjectSelectionResult> {
    this.selectionInferenceCount += 1;
    this.pendingHoverPoint = null;
    this.gate.supersede();
    try {
      signal.throwIfAborted();
      report(0.05, 'Preparing Object Selection source');
      if (!await this.prepareSource(command.sourceLayerId, command.sampleAllLayers,
        false, signal) || !this.source) throw new Error('Object Selection source preparation failed.');
      signal.throwIfAborted();
      const prepared = await this.gate.prepare(this.source, signal);
      if (!prepared) throw new Error('Object Selection source was superseded.');
      report(0.35, 'Running Object Selection inference');
      const options = this.callbacks.getOptions();
      const candidates = await this.gate.subject(prepared, {
        refineEdges: options.refineEdges,
        refinementQuality: options.refinementQuality,
        signal
      });
      signal.throwIfAborted();
      const candidate = candidates ? bestCandidate(candidates) : null;
      if (!candidate) throw new Error('Object Selection found no matching object.');
      report(0.8, 'Applying Object Selection mask');
      const result = await this.commitSubjectCandidate(candidate, command);
      if (!result) throw new Error('Object Selection result became stale before commit.');
      report(1, 'Object Selection applied');
      return result;
    } finally {
      this.selectionInferenceCount = Math.max(0, this.selectionInferenceCount - 1);
      if (!this.disposed && this.pendingHoverPoint) void this.drainHoverInference();
    }
  }

  private currentSubjectCommand(mode: SelectionCombineMode): SemanticSubjectSelectionCommand | null {
    const document = this.callbacks.getDocument();
    if (!document?.activeLayerId) return null;
    return {
      kind: 'subject', sourceLayerId: document.activeLayerId, mode,
      sampleAllLayers: this.callbacks.getOptions().sampleAllLayers
    };
  }

  hover(point: SelectionPoint) {
    if (this.callbacks.getOptions().mode !== 'object-finder') return;
    if (candidateAtPoint(this.preview, point)) {
      this.pendingHoverPoint = null;
      return;
    }
    this.pendingHoverPoint = point;
    void this.drainHoverInference();
  }

  selectPoint(point: SelectionPoint, mode: SelectionCombineMode) {
    traceSmartSelection('point-requested', { x: point.x, y: point.y, mode });
    this.pendingHoverPoint = null;
    if (candidateAtPoint(this.preview, point)) {
      if (this.callbacks.getOptions().refineEdges) {
        // Hover deliberately skips matte refinement. A click is authoritative
        // and repeats the prompt with the configured final quality.
        void this.selectPrompt({ points: [{ point, label: 'positive' }] }, mode);
      } else {
        this.gate.supersede();
        void this.commitInteractiveCandidate(this.preview!, mode);
      }
      return true;
    }
    void this.selectPrompt({ points: [{ point, label: 'positive' }] }, mode);
    return true;
  }

  async selectSubject(mode: SelectionCombineMode = 'replace') {
    const command = this.currentSubjectCommand(mode);
    if (!command) return false;
    try {
      this.callbacks.setStatus('Finding subject…');
      const result = await this.executeSubjectSelection(
        command, new AbortController().signal, () => undefined
      );
      const recorded = this.callbacks.onSelectionCommitted?.(command, result);
      traceSmartSelection('action-observed', { recorded: recorded === true });
      this.callbacks.setStatus(null);
      return true;
    } catch (reason) {
      this.callbacks.setStatus(reason instanceof Error
        ? `Select Subject is unavailable: ${reason.message}`
        : 'Select Subject is unavailable.');
      return false;
    }
  }

  owns(pointerId: number) { return this.region?.pointerId === pointerId; }

  beginRegion(pointerId: number, point: SelectionPoint, mode: SelectionCombineMode) {
    const selectionMode = this.callbacks.getOptions().mode;
    traceSmartSelection('region-begin', { pointerId, selectionMode, x: point.x, y: point.y });
    if (selectionMode === 'object-finder' || this.region) return false;
    this.region = {
      pointerId,
      kind: selectionMode === 'rectangle' ? 'rectangle' : 'free',
      points: [point, point],
      mode
    };
    this.publishRegionDraft();
    return true;
  }

  moveRegion(pointerId: number, point: SelectionPoint) {
    const region = this.region;
    if (!region || region.pointerId !== pointerId) return false;
    if (region.kind === 'rectangle') region.points[1] = point;
    else region.points.push(point);
    this.publishRegionDraft();
    return true;
  }

  finishRegion(pointerId: number) {
    const region = this.region;
    if (!region || region.pointerId !== pointerId) return false;
    this.region = null;
    this.callbacks.setDraft(null);
    const xs = region.points.map(({ x }) => x);
    const ys = region.points.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    traceSmartSelection('region-finish', { pointerId, x, y, width, height });
    if (width < 1 || height < 1) return false;
    void this.selectPrompt({ points: [], box: { x, y, width, height } }, region.mode);
    return true;
  }

  cancelRegion(pointerId: number) {
    if (!this.region || this.region.pointerId !== pointerId) return false;
    this.region = null;
    this.callbacks.setDraft(null);
    return true;
  }

  invalidate() {
    this.preparing = null;
    this.source = null;
    this.gate.invalidate();
    this.region = null;
    this.callbacks.setDraft(null);
    this.clearPreview();
    this.callbacks.setStatus(null);
    this.callbacks.onPreparationChange?.({ phase: 'idle' });
  }

  clearPreview() {
    this.pendingHoverPoint = null;
    this.preview = null;
    this.callbacks.getRenderer()?.setSmartSelectionPreview(null);
  }

  clearHoverPreview() {
    this.pendingHoverPoint = null;
    this.clearPreview();
  }

  dispose() {
    this.disposed = true;
    this.unsubscribeBackendStatus?.();
    this.clearPreview();
    this.gate.dispose();
  }

  private async resolvePoint(point: SelectionPoint) {
    try {
      if (!await this.prepare() || !this.source) return null;
      const prepared = await this.gate.prepare(this.source);
      if (!prepared) return null;
      const candidates = await this.gate.prompt(prepared, {
        points: [{ point, label: 'positive' }]
      }, {
        // Object Finder remains responsive; final refinement happens on click.
        refineEdges: false,
        refinementQuality: this.callbacks.getOptions().refinementQuality
      });
      const candidate = candidates ? bestCandidate(candidates) : null;
      traceSmartSelection('point-resolved', { candidates: candidates?.length ?? 0 });
      if (!candidate) return null;
      this.publishCandidate(candidate);
      return candidate;
    } catch (reason) {
      this.callbacks.setStatus(reason instanceof Error
        ? `Object Selection is unavailable: ${reason.message}`
        : 'Object Selection is unavailable.');
      return null;
    }
  }

  /** Runs at most one hover decode at a time and retains only the newest pointer position. */
  private async drainHoverInference() {
    if (this.hoverInferenceActive) return;
    this.hoverInferenceActive = true;
    try {
      while (!this.disposed && this.selectionInferenceCount === 0 && this.pendingHoverPoint) {
        const point = this.pendingHoverPoint;
        this.pendingHoverPoint = null;
        await this.resolvePoint(point);
        if (this.pendingHoverPoint && candidateAtPoint(this.preview, this.pendingHoverPoint)) {
          this.pendingHoverPoint = null;
        }
      }
    } finally {
      this.hoverInferenceActive = false;
      if (!this.disposed && this.selectionInferenceCount === 0 && this.pendingHoverPoint) {
        void this.drainHoverInference();
      }
    }
  }

  private async selectPrompt(
    prompt: SmartSelectionPrompt,
    mode: SelectionCombineMode
  ) {
    this.selectionInferenceCount += 1;
    this.pendingHoverPoint = null;
    try {
      this.callbacks.setStatus('Selecting objectâ€¦');
      if (!await this.prepare() || !this.source) return false;
      const prepared = await this.gate.prepare(this.source);
      if (!prepared) return false;
      const candidates = await this.gate.prompt(prepared, prompt, {
        refineEdges: this.callbacks.getOptions().refineEdges,
        refinementQuality: this.callbacks.getOptions().refinementQuality
      });
      const candidate = candidates ? bestCandidate(candidates) : null;
      if (!candidate) {
        this.callbacks.setStatus('No object was found.');
        return false;
      }
      const committed = await this.commitInteractiveCandidate(candidate, mode);
      if (committed) this.callbacks.setStatus(null);
      return Boolean(committed);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown prompt failure.';
      traceSmartSelection('select-error', { message });
      this.callbacks.setStatus(`Object Selection is unavailable: ${message}`);
      return false;
    } finally {
      this.selectionInferenceCount = Math.max(0, this.selectionInferenceCount - 1);
      if (!this.disposed && this.pendingHoverPoint) void this.drainHoverInference();
    }
  }

  private publishCandidate(candidate: SmartSelectionCandidate) {
    this.preview = candidate;
    this.callbacks.getRenderer()?.setSmartSelectionPreview(candidate.mask);
    traceSmartSelection('candidate-published', {
      candidate: candidate.id,
      score: candidate.score,
      ...maskCoverageSummary(candidate.mask)
    });
  }

  private publishBackendIdentity() {
    this.callbacks.onBackendIdentityChange?.(this.backend.identity);
  }

  private async commitSubjectCandidate(
    candidate: SmartSelectionCandidate,
    command: SemanticSubjectSelectionCommand
  ): Promise<SemanticSubjectSelectionResult | false> {
    if (!await this.commitCandidateMask(candidate, command.mode, command)) return false;
    return {
      kind: 'subject', sourceLayerId: command.sourceLayerId,
      mode: command.mode, sampleAllLayers: command.sampleAllLayers
    };
  }

  private commitInteractiveCandidate(candidate: SmartSelectionCandidate, mode: SelectionCombineMode) {
    return this.commitCandidateMask(candidate, mode, null);
  }

  /** Keeps GPU feedback continuous until the authoritative selection mask is live. */
  private async commitCandidateMask(
    candidate: SmartSelectionCandidate,
    mode: SelectionCombineMode,
    command: SemanticSubjectSelectionCommand | null
  ): Promise<boolean> {
    if (!this.sourceIsCurrent(candidate.mask, command)) {
      traceSmartSelection('commit-rejected', { reason: 'stale-source' });
      return false;
    }
    this.preview = candidate;
    this.callbacks.getRenderer()?.setSmartSelectionPreview(candidate.mask);
    if (!await this.callbacks.selection.rasterMask(candidate.mask, mode)) {
      traceSmartSelection('commit-rejected');
      return false;
    }
    traceSmartSelection('committed', maskCoverageSummary(candidate.mask));
    this.clearPreview();
    return true;
  }

  private sourceIsCurrent(
    mask: RasterSelectionMask,
    command: SemanticSubjectSelectionCommand | null
  ) {
    const document = this.callbacks.getDocument();
    const source = this.source;
    if (!document || !source) return false;
    const sampleAllLayers = command?.sampleAllLayers
      ?? this.callbacks.getOptions().sampleAllLayers;
    const currentKey = [
      document.id,
      document.revision,
      sampleAllLayers ? 'composite' : command?.sourceLayerId ?? document.activeLayerId
    ].join(':');
    return source.key === currentKey
      && source.documentRevision === document.revision
      && mask.width === document.width
      && mask.height === document.height;
  }

  private publishRegionDraft() {
    if (!this.region) return;
    this.callbacks.setDraft({ kind: this.region.kind, points: [...this.region.points] });
  }
}
