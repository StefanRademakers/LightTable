import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import type { ImageDocument, LayerId, Rect } from '../../../editor/document/documentTypes';
import type { EditorSession } from '../../../editor/session/editorSession';
import type { AffineMatrix, TransformQuad, TransformSessionState } from '../../../editor/tools/transform/transformTypes';
import { buildTransformEditingFrame } from '../../../editor/tools/transform/transformEditingFrame';
import { transformSessionFrame, type TransformFrameMode, type TransformSessionFrame } from '../../../editor/tools/transform/transformSessionFrame';
import { buildSmartGuideEditingFrame } from '../../../editor/tools/transform/smartGuideEditingFrame';
import { buildLayerSnapTargets } from '../snapping/layerSnapGeometry';
import type { SnapMatch } from '../snapping/snapEngine';

export interface TransformPresentationRenderer {
  setTransformEditingFrame(frame: VectorSelectionFrame | null): void;
  setSmartGuideEditingFrame(frame: VectorSelectionFrame | null): void;
}

export interface TransformPresentationInputs {
  readonly state: TransformSessionState | null;
  readonly frameOverride: TransformSessionFrame | null;
  readonly temporaryMove: boolean;
  readonly scale: number;
  readonly frameMode: TransformFrameMode;
  readonly snap: EditorSession['snap'];
  readonly selectionFeedback: { readonly matches: readonly SnapMatch[]; readonly bounds: Rect | null };
  readonly document: ImageDocument | null;
  readonly selectedLayerIds: readonly LayerId[];
}

export interface TransformPresentationOperations {
  update(matrix: AffineMatrix): TransformSessionState | null;
  updateProjective(quad: TransformQuad): TransformSessionState | null;
}

/** Renderer-scoped cage/guide projection. It owns neither transform edits nor a frame queue. */
export class TransformPresentationBinding {
  private mounted = false;
  private state: TransformSessionState | null = null;
  private observedState: TransformSessionState | null | undefined;
  private matches: readonly SnapMatch[] = [];

  constructor(private readonly renderer: TransformPresentationRenderer | null,
    private readonly isCurrent: () => boolean,
    private readonly read: () => TransformPresentationInputs,
    private readonly operations: TransformPresentationOperations) {}

  mount = () => { this.mounted = true; this.present(); };
  unmount = () => {
    if (!this.mounted) return;
    this.mounted = false;
    this.state = null;
    this.observedState = undefined;
    this.matches = [];
    if (!this.isCurrent()) return;
    this.renderer?.setTransformEditingFrame(null);
    this.renderer?.setSmartGuideEditingFrame(null);
  };
  present = () => {
    if (!this.available()) return;
    const state = this.read().state;
    // Pointer previews intentionally do not update React. Only a new checkpoint
    // replaces the retained preview; unrelated chrome renders must not snap it back.
    if (state !== this.observedState) {
      this.observedState = state;
      this.state = state;
    }
    if (!this.state) this.matches = [];
    this.publish();
  };
  update = (matrix: AffineMatrix, matches: readonly SnapMatch[]) =>
    this.apply(() => this.operations.update(matrix), matches);
  updateProjective = (quad: TransformQuad, matches: readonly SnapMatch[]) =>
    this.apply(() => this.operations.updateProjective(quad), matches);
  setSnapMatches = (matches: readonly SnapMatch[]) => {
    if (!this.available()) return;
    this.matches = matches;
    this.publish();
  };
  getSnapTargets = () => {
    if (!this.available()) return [];
    const inputs = this.read();
    return inputs.document && this.state ? buildLayerSnapTargets(inputs.document, {
      excludedLayerIds: new Set([this.state.layerId, ...inputs.selectedLayerIds]),
      includeCanvas: inputs.snap.targets.documentBounds,
      includeLayers: inputs.snap.targets.layers,
      includeGuides: inputs.snap.targets.guides,
      movingBounds: this.frame(inputs)?.bounds
    }) : [];
  };
  private available() { return this.mounted && this.isCurrent(); }
  private apply(operation: () => TransformSessionState | null, matches: readonly SnapMatch[]) {
    if (!this.available()) return false;
    const next = operation();
    if (!this.available()) return false;
    this.state = next;
    this.matches = next ? matches : [];
    this.publish();
    return next !== null;
  }
  private frame(inputs: TransformPresentationInputs) {
    return this.state && !inputs.temporaryMove ? buildTransformEditingFrame(this.state,
      inputs.scale, inputs.frameOverride ?? transformSessionFrame(this.state, inputs.frameMode)) : null;
  }
  private publish() {
    const inputs = this.read();
    const frame = this.frame(inputs);
    this.renderer?.setTransformEditingFrame(frame);
    const feedback = frame ? { bounds: frame.bounds, matches: this.matches } : inputs.selectionFeedback;
    this.renderer?.setSmartGuideEditingFrame(inputs.snap.extrasVisible !== false
      && inputs.snap.smartGuidesVisible && feedback.bounds
      ? buildSmartGuideEditingFrame(feedback.matches, feedback.bounds, inputs.scale) : null);
  }
}
