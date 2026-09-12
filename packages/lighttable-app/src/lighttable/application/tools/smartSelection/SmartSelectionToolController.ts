import type { ImageDocument } from '../../../editor/document/documentTypes';
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
  SmartSelectionPrompt
} from './SmartSelectionBackend';
import { BalancedSmartSelectionBackend } from './BalancedSmartSelectionBackend';
import { SmartSelectionSourceSession } from './SmartSelectionSourceSession';
import type { DocumentProcessingState } from '../../documents/documentSession';
import { traceSmartSelection } from './smartSelectionTrace';
import {
  SmartSelectionPreviewLease,
  type SmartSelectionPreviewRenderer,
} from './SmartSelectionPreviewLease';
import type {
  SemanticSubjectSelectionCommand,
  SemanticSubjectSelectionResult
} from '../../commands/semanticSubjectSelectionCommandContract';

export interface SmartSelectionToolCallbacks {
  readonly captureScope: () => { isCurrent(): boolean };
  readonly getDocument: () => ImageDocument | null;
  readonly getProcessing: () => DocumentProcessingState | null;
  readonly getRenderer: () => SmartSelectionPreviewRenderer | null;
  readonly isRendererReady: () => boolean;
  readonly getOptions: () => SmartSelectionOptions;
  readonly selection: Pick<SelectionSessionController, 'rasterMask'>;
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

/** Owns transient async Object Selection interaction, never document state. */
export class SmartSelectionToolController {
  private readonly sourceSession: SmartSelectionSourceSession;
  private readonly preview = new SmartSelectionPreviewLease();
  private interactiveCommit = new AbortController();
  private pendingHoverPoint: SelectionPoint | null = null;
  private hoverInferenceActive = false;
  private selectionInferenceCount = 0;
  private region: {
    pointerId: number;
    kind: 'rectangle' | 'free';
    points: SelectionPoint[];
    mode: SelectionCombineMode;
    isCurrent(): boolean;
  } | null = null;
  private disposed = false;

  constructor(
    private readonly callbacks: SmartSelectionToolCallbacks,
    backend: SmartSelectionBackend = new BalancedSmartSelectionBackend()
  ) {
    this.sourceSession = new SmartSelectionSourceSession(callbacks, backend);
  }

  prepare() { return this.sourceSession.prepareCurrent(); }

  async executeSubjectSelection(
    command: SemanticSubjectSelectionCommand,
    signal: AbortSignal,
    report: (progress: number, message: string) => void
  ): Promise<SemanticSubjectSelectionResult> {
    const isCurrent = this.sourceSession.captureRequest(signal);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (!isCurrent()) throw new Error('Object Selection request is no longer current.');
    };
    assertCurrent();
    this.selectionInferenceCount += 1;
    this.pendingHoverPoint = null;
    this.sourceSession.supersede();
    try {
      assertCurrent();
      report(0.05, 'Preparing Object Selection source');
      if (!await this.sourceSession.prepare(command.sourceLayerId, command.sampleAllLayers,
        false, signal)) throw new Error('Object Selection source preparation failed.');
      assertCurrent();
      const prepared = await this.sourceSession.prepared(signal);
      assertCurrent();
      if (!prepared) throw new Error('Object Selection source was superseded.');
      report(0.35, 'Running Object Selection inference');
      const options = this.callbacks.getOptions();
      const candidates = await this.sourceSession.subject(prepared, {
        refineEdges: options.refineEdges,
        refinementQuality: options.refinementQuality,
        signal
      });
      assertCurrent();
      const candidate = candidates ? bestCandidate(candidates) : null;
      if (!candidate) throw new Error('Object Selection found no matching object.');
      report(0.8, 'Applying Object Selection mask');
      const result = await this.commitSubjectCandidate(candidate, command, signal);
      assertCurrent();
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
    if (!this.sourceSession.captureRequest(undefined, true)()) return;
    if (this.callbacks.getOptions().mode !== 'object-finder') return;
    if (candidateAtPoint(this.preview.candidate, point)) {
      this.pendingHoverPoint = null;
      return;
    }
    this.pendingHoverPoint = point;
    void this.drainHoverInference();
  }

  selectPoint(point: SelectionPoint, mode: SelectionCombineMode) {
    if (!this.sourceSession.captureRequest(undefined, true)()) return false;
    traceSmartSelection('point-requested', { x: point.x, y: point.y, mode });
    this.pendingHoverPoint = null;
    if (candidateAtPoint(this.preview.candidate, point)) {
      if (this.callbacks.getOptions().refineEdges) {
        // Hover deliberately skips matte refinement. A click is authoritative
        // and repeats the prompt with the configured final quality.
        void this.selectPrompt({ points: [{ point, label: 'positive' }] }, mode);
      } else {
        this.sourceSession.supersede();
        void this.commitInteractiveCandidate(this.preview.candidate!, mode);
      }
      return true;
    }
    void this.selectPrompt({ points: [{ point, label: 'positive' }] }, mode);
    return true;
  }

  async selectSubject(mode: SelectionCombineMode = 'replace') {
    const isCurrent = this.sourceSession.captureRequest(this.interactiveCommit.signal, true);
    if (!isCurrent()) return false;
    const command = this.currentSubjectCommand(mode);
    if (!command) return false;
    try {
      this.callbacks.setStatus('Finding subject…');
      const result = await this.executeSubjectSelection(
        command, this.interactiveCommit.signal, () => undefined
      );
      if (!isCurrent()) return false;
      const recorded = this.callbacks.onSelectionCommitted?.(command, result);
      traceSmartSelection('action-observed', { recorded: recorded === true });
      this.callbacks.setStatus(null);
      return true;
    } catch (reason) {
      if (isCurrent()) this.callbacks.setStatus(reason instanceof Error
        ? `Select Subject is unavailable: ${reason.message}`
        : 'Select Subject is unavailable.');
      return false;
    }
  }

  owns(pointerId: number) { return this.region?.pointerId === pointerId && this.region.isCurrent(); }

  beginRegion(pointerId: number, point: SelectionPoint, mode: SelectionCombineMode) {
    const isCurrent = this.sourceSession.captureRequest(undefined, true);
    const selectionMode = this.callbacks.getOptions().mode;
    traceSmartSelection('region-begin', { pointerId, selectionMode, x: point.x, y: point.y });
    if (!isCurrent() || selectionMode === 'object-finder' || this.region) return false;
    this.region = {
      pointerId,
      kind: selectionMode === 'rectangle' ? 'rectangle' : 'free',
      points: [point, point],
      mode, isCurrent
    };
    this.publishRegionDraft();
    return true;
  }

  moveRegion(pointerId: number, point: SelectionPoint) {
    const region = this.region;
    if (!region || region.pointerId !== pointerId || !region.isCurrent()) return false;
    if (region.kind === 'rectangle') region.points[1] = point;
    else region.points.push(point);
    this.publishRegionDraft();
    return true;
  }

  finishRegion(pointerId: number) {
    const region = this.region;
    if (!region || region.pointerId !== pointerId || !region.isCurrent()) return false;
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
    if (!this.region || this.region.pointerId !== pointerId || !this.region.isCurrent()) return false;
    this.region = null;
    this.callbacks.setDraft(null);
    return true;
  }

  invalidate() {
    this.interactiveCommit.abort();
    this.interactiveCommit = new AbortController();
    this.sourceSession.invalidate();
    this.region = null;
    this.callbacks.setDraft(null);
    this.clearPreview();
    this.callbacks.setStatus(null);
    this.callbacks.onPreparationChange?.({ phase: 'idle' });
  }

  clearPreview() {
    this.pendingHoverPoint = null;
    this.preview.clear();
  }

  clearHoverPreview() {
    this.pendingHoverPoint = null;
    this.clearPreview();
  }

  dispose() {
    this.disposed = true;
    this.interactiveCommit.abort();
    this.clearPreview();
    this.sourceSession.dispose();
  }

  private async resolvePoint(point: SelectionPoint) {
    const isCurrent = this.sourceSession.captureRequest(undefined, true);
    try {
      if (!isCurrent() || !await this.prepare() || !isCurrent()) return null;
      const prepared = await this.sourceSession.prepared();
      if (!prepared || !isCurrent()) return null;
      const candidates = await this.sourceSession.prompt(prepared, {
        points: [{ point, label: 'positive' }]
      }, {
        // Object Finder remains responsive; final refinement happens on click.
        refineEdges: false,
        refinementQuality: this.callbacks.getOptions().refinementQuality
      });
      const candidate = candidates ? bestCandidate(candidates) : null;
      traceSmartSelection('point-resolved', { candidates: candidates?.length ?? 0 });
      if (!candidate || !isCurrent() || !this.sourceSession.matches(candidate.mask, null)) return null;
      this.publishCandidate(candidate);
      return candidate;
    } catch (reason) {
      if (isCurrent()) this.callbacks.setStatus(reason instanceof Error
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
        if (this.pendingHoverPoint && candidateAtPoint(this.preview.candidate, this.pendingHoverPoint)) {
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
    const signal = this.interactiveCommit.signal;
    const isCurrent = this.sourceSession.captureRequest(signal, true);
    if (!isCurrent()) return false;
    this.selectionInferenceCount += 1;
    this.pendingHoverPoint = null;
    try {
      this.callbacks.setStatus('Selecting objectâ€¦');
      if (!await this.prepare() || !isCurrent()) return false;
      const prepared = await this.sourceSession.prepared();
      if (!prepared || !isCurrent()) return false;
      const candidates = await this.sourceSession.prompt(prepared, prompt, {
        refineEdges: this.callbacks.getOptions().refineEdges,
        refinementQuality: this.callbacks.getOptions().refinementQuality
      });
      if (!isCurrent()) return false;
      const candidate = candidates ? bestCandidate(candidates) : null;
      if (!candidate) {
        this.callbacks.setStatus('No object was found.');
        return false;
      }
      const committed = await this.commitCandidateMask(candidate, mode, null, signal);
      if (committed && isCurrent()) this.callbacks.setStatus(null);
      return Boolean(committed);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown prompt failure.';
      traceSmartSelection('select-error', { message });
      if (isCurrent()) this.callbacks.setStatus(`Object Selection is unavailable: ${message}`);
      return false;
    } finally {
      this.selectionInferenceCount = Math.max(0, this.selectionInferenceCount - 1);
      if (!this.disposed && this.pendingHoverPoint) void this.drainHoverInference();
    }
  }

  private publishCandidate(candidate: SmartSelectionCandidate) {
    const renderer = this.callbacks.getRenderer();
    const owner = this.preview.publish(candidate, renderer, this.callbacks.captureScope());
    traceSmartSelection('candidate-published', {
      candidate: candidate.id,
      score: candidate.score,
      ...maskCoverageSummary(candidate.mask)
    });
    return owner;
  }

  private async commitSubjectCandidate(
    candidate: SmartSelectionCandidate,
    command: SemanticSubjectSelectionCommand,
    signal: AbortSignal,
  ): Promise<SemanticSubjectSelectionResult | false> {
    if (!await this.commitCandidateMask(candidate, command.mode, command, signal)) return false;
    return {
      kind: 'subject', sourceLayerId: command.sourceLayerId,
      mode: command.mode, sampleAllLayers: command.sampleAllLayers
    };
  }

  private commitInteractiveCandidate(candidate: SmartSelectionCandidate, mode: SelectionCombineMode) {
    return this.commitCandidateMask(candidate, mode, null, this.interactiveCommit.signal);
  }

  /** Keeps GPU feedback continuous until the authoritative selection mask is live. */
  private async commitCandidateMask(
    candidate: SmartSelectionCandidate,
    mode: SelectionCombineMode,
    command: SemanticSubjectSelectionCommand | null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const isCurrent = this.sourceSession.captureRequest(signal, command === null);
    if (!isCurrent() || !this.sourceSession.matches(candidate.mask, command)) {
      traceSmartSelection('commit-rejected', { reason: 'stale-source' });
      return false;
    }
    const preview = this.publishCandidate(candidate);
    let committed = false;
    try {
      committed = signal
        ? await this.callbacks.selection.rasterMask(candidate.mask, mode, signal)
        : await this.callbacks.selection.rasterMask(candidate.mask, mode);
    } finally {
      this.preview.release(preview);
    }
    if (!committed || !isCurrent()) {
      traceSmartSelection('commit-rejected');
      return false;
    }
    traceSmartSelection('committed', maskCoverageSummary(candidate.mask));
    return true;
  }

  private publishRegionDraft() {
    if (!this.region) return;
    this.callbacks.setDraft({ kind: this.region.kind, points: [...this.region.points] });
  }
}
