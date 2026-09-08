import type {
  CommittedSelectionState,
  DocumentAddress,
  PreparedSelectionProjection,
  SelectionProjectionActivation,
  SelectionRevision,
  TransactionId,
} from '@lighttable/editor-kernel';
import { SelectionMaskSnapshot } from '../selection/SelectionMaskSnapshot';
import type { LayerId } from '../document/documentTypes';
import type {
  MagicWandOptions,
  SelectionCombineMode,
  SelectionOperation,
  SelectionPoint,
  SelectionShape,
} from '../selection/selectionTypes';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import type { SelectionCoverageBounds } from '../selection/selectionCoverage';
import {
  SelectionTextureStore,
  type SelectionTargetState,
} from './SelectionTextureStore';

export interface SelectionShapeProjectionIntent {
  readonly shape: SelectionShape;
  readonly mode: SelectionCombineMode;
  readonly featherRadius: number;
  readonly antiAlias: boolean;
  readonly provenance: SelectionOperation;
}

export interface SelectionTranslationProjectionIntent {
  readonly x: number;
  readonly y: number;
  readonly provenance: SelectionOperation;
}

export interface SelectionPaintProjectionIntent {
  readonly dabs: readonly BrushDab[];
  readonly hardness: number;
  readonly opacity: number;
  readonly mode: 'add' | 'subtract';
  readonly provenance: SelectionOperation;
}

export interface SelectionMagicWandProjectionIntent {
  readonly layerId: LayerId;
  readonly point: SelectionPoint;
  readonly options: MagicWandOptions;
  readonly mode: SelectionCombineMode;
  readonly provenance: SelectionOperation;
}

interface SelectionProjectionStage {
  readonly textures: SelectionTextureStore;
  restore(snapshot: SelectionMaskSnapshot): boolean;
  apply(intent: SelectionShapeProjectionIntent): boolean;
  transform(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }): boolean;
  paint(intent: SelectionPaintProjectionIntent): boolean;
  magicWand?(source: GPUTexture, intent: SelectionMagicWandProjectionIntent): boolean;
  capture(): Promise<SelectionMaskSnapshot>;
  measure(): Promise<SelectionCoverageBounds | null>;
  dispose(): void;
}

interface SelectionShapeProjectionServiceOptions {
  readonly committedTextures: SelectionTextureStore;
  readonly createStage: () => SelectionProjectionStage;
}

type SelectionState = CommittedSelectionState<SelectionMaskSnapshot, SelectionOperation>;

class PreparedShapeProjection implements PreparedSelectionProjection<
  SelectionMaskSnapshot,
  SelectionOperation
> {
  private phase: 'prepared' | 'activated' | 'terminal' = 'prepared';
  private priorState: SelectionTargetState | null = null;

  constructor(
    readonly transactionId: TransactionId,
    readonly baselineRevision: SelectionRevision,
    readonly result: SelectionState,
    private readonly committedTextures: SelectionTextureStore,
    private readonly stage: SelectionProjectionStage,
    private readonly recycle: (
      stage: SelectionProjectionStage,
      state: SelectionTargetState,
    ) => void,
  ) {}

  activate(): SelectionProjectionActivation {
    if (this.phase !== 'prepared') {
      throw new Error('A prepared selection projection can only be activated once.');
    }
    // Selection targets are intentionally lazy on a new document. Allocate the
    // empty committed set before detaching the prepared set so activation can
    // never strand the stage when the first selection is committed.
    this.committedTextures.ensureTargets();
    const replacement = this.stage.textures.detachState();
    try {
      this.priorState = this.committedTextures.exchangeState(replacement);
    } catch (reason) {
      this.stage.textures.attachState(replacement);
      throw reason;
    }
    this.phase = 'activated';
    let resolved = false;
    return {
      accept: () => {
        if (resolved || this.phase !== 'activated' || !this.priorState) {
          return;
        }
        resolved = true;
        try {
          this.recycle(this.stage, this.priorState);
        } catch {
          try { this.stage.dispose(); } catch { /* terminal cleanup is best-effort */ }
        }
        this.priorState = null;
        this.phase = 'terminal';
      },
      rollback: () => {
        if (resolved || this.phase !== 'activated' || !this.priorState) {
          throw new Error('The selection projection activation is already resolved.');
        }
        resolved = true;
        const rejected = this.committedTextures.exchangeState(this.priorState);
        this.recycle(this.stage, rejected);
        this.priorState = null;
        this.phase = 'terminal';
      },
    };
  }

  dispose(): void {
    if (this.phase === 'terminal') return;
    if (this.phase === 'activated' && this.priorState) {
      const rejected = this.committedTextures.exchangeState(this.priorState);
      this.recycle(this.stage, rejected);
      this.priorState = null;
    } else {
      this.recycle(this.stage, this.stage.textures.detachState());
    }
    this.phase = 'terminal';
  }
}

/** Prepares exact shape coverage away from the committed renderer projection. */
export class SelectionShapeProjectionService {
  private spare: { readonly width: number; readonly height: number;
    readonly stage: SelectionProjectionStage } | null = null;
  private disposed = false;

  constructor(private readonly options: SelectionShapeProjectionServiceOptions) {}

  dispose(): void {
    this.disposed = true;
    if (!this.spare) return;
    this.spare.stage.dispose();
    this.spare = null;
  }

  private createStage(width: number, height: number): SelectionProjectionStage {
    if (this.disposed) throw new Error('The selection projection service is disposed.');
    if (!this.spare) return this.options.createStage();
    const spare = this.spare;
    this.spare = null;
    if (spare.width === width && spare.height === height) return spare.stage;
    spare.stage.dispose();
    return this.options.createStage();
  }

  private recycle(
    width: number,
    height: number,
    stage: SelectionProjectionStage,
    state: SelectionTargetState,
  ): void {
    stage.textures.attachState(state);
    if (this.disposed) {
      stage.dispose();
      return;
    }
    this.spare?.stage.dispose();
    this.spare = { width, height, stage };
  }

  async prepare(
    document: DocumentAddress,
    baseline: SelectionState,
    intent: SelectionShapeProjectionIntent,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>> {
    if (baseline.documentSessionId !== document.sessionId) {
      throw new Error('The selection baseline belongs to another document session.');
    }
    if (signal.aborted) throw new DOMException('Selection preparation was cancelled.', 'AbortError');
    const stage = this.createStage(baseline.canvas.width, baseline.canvas.height);
    const recycle = (nextStage: SelectionProjectionStage, state: SelectionTargetState) => this.recycle(
      baseline.canvas.width, baseline.canvas.height, nextStage, state,
    );
    try {
      stage.textures.ensureTargets();
      if (!stage.restore(baseline.coverage)) {
        throw new Error('The selection baseline could not be staged.');
      }
      if (!stage.apply(intent)) {
        throw new Error('The selection shape could not be rasterized.');
      }
      const capturedCoverage = await stage.capture();
      if (signal.aborted) throw new DOMException('Selection preparation was cancelled.', 'AbortError');
      const measured = await stage.measure();
      if (signal.aborted) throw new DOMException('Selection preparation was cancelled.', 'AbortError');
      // Subtract/intersect may legitimately remove the final covered pixel.
      // Normalize that result to the same inactive value every consumer uses.
      const coverage = measured
        ? capturedCoverage
        : SelectionMaskSnapshot.inactive(baseline.canvas.width, baseline.canvas.height);
      stage.textures.active = measured !== null;
      const provenance = !measured ? [] : intent.mode === 'replace'
        ? [intent.provenance]
        : [...baseline.provenance, intent.provenance];
      const result: SelectionState = {
        documentSessionId: document.sessionId,
        revision: (baseline.revision + 1) as SelectionRevision,
        canvas: { ...baseline.canvas },
        active: measured !== null,
        coverage,
        supportBounds: measured?.supportBounds ?? null,
        provenance,
      };
      return new PreparedShapeProjection(
        transactionId,
        baseline.revision,
        result,
        this.options.committedTextures,
        stage,
        recycle,
      );
    } catch (reason) {
      recycle(stage, stage.textures.detachState());
      throw reason;
    }
  }

  async prepareMagicWand(
    document: DocumentAddress,
    baseline: SelectionState,
    intent: SelectionMagicWandProjectionIntent,
    source: GPUTexture,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>> {
    if (baseline.documentSessionId !== document.sessionId) {
      throw new Error('The Magic Wand baseline belongs to another document session.');
    }
    if (signal.aborted) throw new DOMException('Magic Wand was cancelled.', 'AbortError');
    const stage = this.createStage(baseline.canvas.width, baseline.canvas.height);
    const recycle = (nextStage: SelectionProjectionStage, state: SelectionTargetState) => this.recycle(
      baseline.canvas.width, baseline.canvas.height, nextStage, state,
    );
    try {
      stage.textures.ensureTargets();
      if (!stage.restore(baseline.coverage)) {
        throw new Error('The Magic Wand baseline could not be staged.');
      }
      if (!stage.magicWand?.(source, intent)) {
        throw new Error('The Magic Wand selection could not be computed.');
      }
      const capturedCoverage = await stage.capture();
      if (signal.aborted) throw new DOMException('Magic Wand was cancelled.', 'AbortError');
      const measured = await stage.measure();
      if (signal.aborted) throw new DOMException('Magic Wand was cancelled.', 'AbortError');
      const coverage = measured
        ? capturedCoverage
        : SelectionMaskSnapshot.inactive(baseline.canvas.width, baseline.canvas.height);
      stage.textures.active = measured !== null;
      const provenance = !measured ? [] : intent.mode === 'replace'
        ? [intent.provenance]
        : [...baseline.provenance, intent.provenance];
      const result: SelectionState = {
        documentSessionId: document.sessionId,
        revision: (baseline.revision + 1) as SelectionRevision,
        canvas: { ...baseline.canvas },
        active: measured !== null,
        coverage,
        supportBounds: measured?.supportBounds ?? null,
        provenance,
      };
      return new PreparedShapeProjection(
        transactionId, baseline.revision, result,
        this.options.committedTextures, stage, recycle,
      );
    } catch (reason) {
      recycle(stage, stage.textures.detachState());
      throw reason;
    }
  }

  async prepareSnapshot(
    document: DocumentAddress,
    baseline: SelectionState,
    target: SelectionState,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>> {
    if (baseline.documentSessionId !== document.sessionId
      || target.documentSessionId !== document.sessionId) {
      throw new Error('The selection restore belongs to another document session.');
    }
    if (target.canvas.width !== baseline.canvas.width
      || target.canvas.height !== baseline.canvas.height) {
      throw new Error('The selection restore has different canvas dimensions.');
    }
    if (signal.aborted) throw new DOMException('Selection restore was cancelled.', 'AbortError');
    const stage = this.createStage(baseline.canvas.width, baseline.canvas.height);
    const recycle = (nextStage: SelectionProjectionStage, state: SelectionTargetState) => this.recycle(
      baseline.canvas.width, baseline.canvas.height, nextStage, state,
    );
    try {
      stage.textures.ensureTargets();
      if (!stage.restore(target.coverage)) {
        throw new Error('The selection snapshot could not be staged.');
      }
      const captured = await stage.capture();
      if (signal.aborted) throw new DOMException('Selection restore was cancelled.', 'AbortError');
      const measured = target.active ? await stage.measure() : null;
      if (signal.aborted) throw new DOMException('Selection restore was cancelled.', 'AbortError');
      if (target.active && !measured && target.supportBounds !== null) {
        throw new Error('The restored selection has no measurable coverage.');
      }
      const coverage = target.coverage.translation
        ? captured.withTranslation(target.coverage, 0, 0)
        : captured;
      const result: SelectionState = {
        documentSessionId: document.sessionId,
        revision: (baseline.revision + 1) as SelectionRevision,
        canvas: { ...baseline.canvas },
        active: target.active,
        coverage,
        supportBounds: measured?.supportBounds ?? null,
        provenance: [...target.provenance],
      };
      return new PreparedShapeProjection(
        transactionId, baseline.revision, result,
        this.options.committedTextures, stage,
        recycle,
      );
    } catch (reason) {
      recycle(stage, stage.textures.detachState());
      throw reason;
    }
  }

  async prepareTranslation(
    document: DocumentAddress,
    baseline: SelectionState,
    intent: SelectionTranslationProjectionIntent,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>> {
    if (baseline.documentSessionId !== document.sessionId) {
      throw new Error('The selection translation belongs to another document session.');
    }
    if (!baseline.active || !Number.isFinite(intent.x) || !Number.isFinite(intent.y)) {
      throw new Error('Selection translation requires active coverage and a finite displacement.');
    }
    if (signal.aborted) throw new DOMException('Selection translation was cancelled.', 'AbortError');
    const stage = this.createStage(baseline.canvas.width, baseline.canvas.height);
    const recycle = (nextStage: SelectionProjectionStage, state: SelectionTargetState) => this.recycle(
      baseline.canvas.width, baseline.canvas.height, nextStage, state,
    );
    try {
      stage.textures.ensureTargets();
      const lineage = baseline.coverage.translation;
      const source = lineage?.source ?? baseline.coverage;
      const x = (lineage?.x ?? 0) + intent.x;
      const y = (lineage?.y ?? 0) + intent.y;
      if (!stage.restore(source) || !stage.transform({
        a: 1, b: 0, c: 0, d: 1, tx: x, ty: y,
      })) {
        throw new Error('The selection translation could not be staged.');
      }
      const captured = await stage.capture();
      if (signal.aborted) throw new DOMException('Selection translation was cancelled.', 'AbortError');
      const measured = await stage.measure();
      if (signal.aborted) throw new DOMException('Selection translation was cancelled.', 'AbortError');
      const result: SelectionState = {
        documentSessionId: document.sessionId,
        revision: (baseline.revision + 1) as SelectionRevision,
        canvas: { ...baseline.canvas },
        active: true,
        coverage: captured.withTranslation(baseline.coverage, intent.x, intent.y),
        supportBounds: measured?.supportBounds ?? null,
        provenance: [...baseline.provenance, intent.provenance],
      };
      return new PreparedShapeProjection(
        transactionId, baseline.revision, result,
        this.options.committedTextures, stage, recycle,
      );
    } catch (reason) {
      recycle(stage, stage.textures.detachState());
      throw reason;
    }
  }

  async preparePaint(
    document: DocumentAddress,
    baseline: SelectionState,
    intent: SelectionPaintProjectionIntent,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>> {
    if (baseline.documentSessionId !== document.sessionId) {
      throw new Error('The painted selection belongs to another document session.');
    }
    if (signal.aborted) throw new DOMException('Selection paint was cancelled.', 'AbortError');
    const stage = this.createStage(baseline.canvas.width, baseline.canvas.height);
    const recycle = (nextStage: SelectionProjectionStage, state: SelectionTargetState) => this.recycle(
      baseline.canvas.width, baseline.canvas.height, nextStage, state,
    );
    try {
      stage.textures.ensureTargets();
      if (!stage.restore(baseline.coverage) || !stage.paint(intent)) {
        throw new Error('The selection brush stroke could not be staged.');
      }
      const capturedCoverage = await stage.capture();
      if (signal.aborted) throw new DOMException('Selection paint was cancelled.', 'AbortError');
      const measured = await stage.measure();
      if (signal.aborted) throw new DOMException('Selection paint was cancelled.', 'AbortError');
      const coverage = measured
        ? capturedCoverage
        : SelectionMaskSnapshot.inactive(baseline.canvas.width, baseline.canvas.height);
      stage.textures.active = measured !== null;
      const result: SelectionState = {
        documentSessionId: document.sessionId,
        revision: (baseline.revision + 1) as SelectionRevision,
        canvas: { ...baseline.canvas },
        active: measured !== null,
        coverage,
        supportBounds: measured?.supportBounds ?? null,
        provenance: measured ? [...baseline.provenance, intent.provenance] : [],
      };
      return new PreparedShapeProjection(
        transactionId, baseline.revision, result,
        this.options.committedTextures, stage, recycle,
      );
    } catch (reason) {
      recycle(stage, stage.textures.detachState());
      throw reason;
    }
  }
}
