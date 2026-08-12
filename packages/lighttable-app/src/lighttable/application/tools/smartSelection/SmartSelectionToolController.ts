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
  SmartSelectionCandidate,
  SmartSelectionSource
} from './SmartSelectionBackend';
import { SlimSamSmartSelectionBackend } from './SlimSamSmartSelectionBackend';
import { SmartSelectionRequestGate } from './SmartSelectionRequestGate';
import {
  createSmartSelectionSource,
  type SmartSelectionSourceRenderer
} from './smartSelectionSource';

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
  private source: SmartSelectionSource | null = null;
  private preparing: { key: string; promise: Promise<boolean> } | null = null;
  private preview: SmartSelectionCandidate | null = null;
  private pendingHoverPoint: SelectionPoint | null = null;
  private hoverInferenceActive = false;
  private committing = false;
  private region: {
    pointerId: number;
    kind: 'rectangle' | 'free';
    mode: SelectionCombineMode;
    points: SelectionPoint[];
  } | null = null;
  private disposed = false;

  constructor(
    private readonly callbacks: SmartSelectionToolCallbacks,
    backend: SmartSelectionBackend = new SlimSamSmartSelectionBackend()
  ) {
    this.gate = new SmartSelectionRequestGate(backend);
  }

  async prepare() {
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
    const options = this.callbacks.getOptions();
    const expectedKey = [
      document.id,
      document.revision,
      options.sampleAllLayers ? 'composite' : document.activeLayerId
    ].join(':');
    if (this.source?.key === expectedKey) return true;
    if (this.preparing?.key === expectedKey) return this.preparing.promise;
    const promise = (async () => {
      this.callbacks.setStatus('Preparing Object Selection…');
      const source = await createSmartSelectionSource(document, renderer, options.sampleAllLayers);
      const current = this.callbacks.getDocument();
      const currentOptions = this.callbacks.getOptions();
      const currentKey = current ? [
        current.id,
        current.revision,
        currentOptions.sampleAllLayers ? 'composite' : current.activeLayerId
      ].join(':') : null;
      if (this.disposed || !current || current.id !== document.id
        || current.revision !== source.documentRevision || currentKey !== expectedKey) return false;
      const prepared = await this.gate.prepare(source);
      if (!prepared || this.disposed) return false;
      this.source = source;
      traceSmartSelection('prepared', { source: source.key });
      this.callbacks.setStatus(null);
      return true;
    })().catch((reason: unknown) => {
      if (!this.disposed) this.callbacks.setStatus(reason instanceof Error
        ? `Object Selection is unavailable: ${reason.message}`
        : 'Object Selection is unavailable.');
      return false;
    }).finally(() => {
      if (this.preparing?.key === expectedKey) this.preparing = null;
    });
    this.preparing = { key: expectedKey, promise };
    return promise;
  }

  hover(point: SelectionPoint) {
    if (this.committing || this.callbacks.getOptions().mode !== 'object-finder') return;
    if (candidateAtPoint(this.preview, point)) {
      this.pendingHoverPoint = null;
      return;
    }
    this.pendingHoverPoint = point;
    void this.drainHoverInference();
  }

  async commitPoint(point: SelectionPoint, mode: SelectionCombineMode) {
    traceSmartSelection('point-requested', { x: point.x, y: point.y, mode });
    this.pendingHoverPoint = null;
    this.committing = true;
    try {
      const candidate = candidateAtPoint(this.preview, point)
        ? this.preview
        : await this.resolvePoint(point, true);
      if (!candidate) {
        traceSmartSelection('point-no-candidate');
        return false;
      }
      return await this.commitCandidate(candidate, mode);
    } finally {
      this.committing = false;
    }
  }

  async commitBox(
    bounds: { x: number; y: number; width: number; height: number },
    mode: SelectionCombineMode
  ) {
    if (!await this.prepare() || !this.source) return false;
    const prepared = await this.gate.prepare(this.source);
    if (!prepared) return false;
    const candidates = await this.gate.box(prepared, bounds, {
      hardEdge: this.callbacks.getOptions().hardEdge
    });
    const candidate = candidates ? bestCandidate(candidates) : null;
    if (!candidate) return false;
    return this.commitCandidate(candidate, mode);
  }

  async selectSubject(mode: SelectionCombineMode = 'replace') {
    try {
      if (!await this.prepare() || !this.source) return false;
      const prepared = await this.gate.prepare(this.source);
      if (!prepared) return false;
      this.callbacks.setStatus('Finding subject…');
      const candidates = await this.gate.subject(prepared, {
        hardEdge: this.callbacks.getOptions().hardEdge
      });
      const candidate = candidates ? bestCandidate(candidates) : null;
      if (!candidate) {
        this.callbacks.setStatus('No subject was found.');
        return false;
      }
      if (!await this.commitCandidate(candidate, mode)) {
        this.callbacks.setStatus('The object selection could not be applied.');
        return false;
      }
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
    if (selectionMode === 'object-finder' || this.region) return false;
    this.clearPreview();
    this.region = {
      pointerId,
      kind: selectionMode === 'rectangle' ? 'rectangle' : 'free',
      mode,
      points: [point, point]
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
    if (width < 1 || height < 1) return false;
    void this.commitBox({ x, y, width, height }, region.mode);
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
  }

  clearPreview() {
    this.pendingHoverPoint = null;
    this.preview = null;
    this.callbacks.getRenderer()?.setSmartSelectionPreview(null);
  }

  dispose() {
    this.disposed = true;
    this.clearPreview();
    this.gate.dispose();
  }

  private async resolvePoint(point: SelectionPoint, commit: boolean) {
    try {
      if (!await this.prepare() || !this.source) return null;
      const prepared = await this.gate.prepare(this.source);
      if (!prepared) return null;
      const candidates = await this.gate.point(prepared, point, {
        hardEdge: this.callbacks.getOptions().hardEdge
      });
      const candidate = candidates ? bestCandidate(candidates) : null;
      traceSmartSelection('point-resolved', { candidates: candidates?.length ?? 0 });
      if (!candidate) return null;
      if (!commit) {
        this.preview = candidate;
        this.callbacks.getRenderer()?.setSmartSelectionPreview(candidate.mask);
      }
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
      while (!this.disposed && !this.committing && this.pendingHoverPoint) {
        const point = this.pendingHoverPoint;
        this.pendingHoverPoint = null;
        await this.resolvePoint(point, false);
        if (this.pendingHoverPoint && candidateAtPoint(this.preview, this.pendingHoverPoint)) {
          this.pendingHoverPoint = null;
        }
      }
    } finally {
      this.hoverInferenceActive = false;
      if (!this.disposed && !this.committing && this.pendingHoverPoint) {
        void this.drainHoverInference();
      }
    }
  }

  /** Keeps GPU feedback continuous until the authoritative selection mask is live. */
  private async commitCandidate(
    candidate: SmartSelectionCandidate,
    mode: SelectionCombineMode
  ) {
    this.preview = candidate;
    this.callbacks.getRenderer()?.setSmartSelectionPreview(candidate.mask);
    if (!await this.callbacks.selection.rasterMask(candidate.mask, mode)) {
      traceSmartSelection('commit-rejected');
      return false;
    }
    traceSmartSelection('committed');
    this.clearPreview();
    return true;
  }

  private publishRegionDraft() {
    if (!this.region) return;
    this.callbacks.setDraft({ kind: this.region.kind, points: [...this.region.points] });
  }
}
