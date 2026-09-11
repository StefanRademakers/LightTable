import type { RasterSelectionMask } from '../editor/selection/selectionTypes';
import {
  BRUSH_CURSOR_THEME,
  GRADIENT_GIZMO_THEME,
  SELECTION_OUTLINE_THEME,
  UNPAINTED_ELEMENT_OUTLINE_THEME,
  VectorEditingOverlayBackend,
  type VectorEditingOverlayTarget,
  type VectorEditingOverlayTheme
} from '@lighttable/vector-webgpu';
import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import { TextEditingOverlayBackend } from '@lighttable/text-webgpu';
import {
  buildBrushCursorEditingOverlay,
  buildSampledBrushSourceEditingOverlay,
  buildSelectionEditingOverlay,
  directSelectionShape
} from '../editor/selection/selectionEditingOverlay';
import { SelectionContourOverlayBackend } from '../editor/rendering/SelectionContourOverlayBackend';
import { SelectionPaintOverlayBackend } from '../editor/rendering/SelectionPaintOverlayBackend';
import { SmartSelectionOverlayBackend } from '../editor/rendering/SmartSelectionOverlayBackend';
import { transformVectorDocumentEditingSceneOverlay } from '../application/vectors/vectorEditingOverlay';
import type { ImageDocument } from '../editor/document/documentTypes';
import type { ViewportRenderState } from '../application/rendering/viewportRenderState';
import type { DocumentEditingOverlayState } from './DocumentEditingOverlayState';

const FACE_WARP_MESH_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.1, 0.82, 0.95, 1],
  handleColor: [0.92, 0.98, 1, 1],
  pathWidthPx: 1,
  handleWidthPx: 1,
  curveSubdivisions: 1
};

const FACE_WARP_RELAX_CURSOR_THEME: VectorEditingOverlayTheme = {
  ...BRUSH_CURSOR_THEME,
  pathColor: [0.2, 0.9, 1, 1],
  underlayColor: [0.02, 0.12, 0.16, 0.95],
  dashLengthPx: 5,
  gapLengthPx: 3
};

const FACE_WARP_RESTORE_CURSOR_THEME: VectorEditingOverlayTheme = {
  ...BRUSH_CURSOR_THEME,
  pathColor: [1, 0.68, 0.18, 1],
  underlayColor: [0.16, 0.08, 0.01, 0.95],
  dashLengthPx: 1,
  gapLengthPx: 3
};

interface EditingOverlayEncodeInput {
  readonly encoder: GPUCommandEncoder;
  readonly canvasView: GPUTextureView;
  readonly document: ImageDocument;
  readonly viewport: ViewportRenderState;
  readonly selectionMask: GPUTexture | null;
  readonly selectionTransformPreviewActive: boolean;
  readonly sampler: GPUSampler | null;
  readonly viewBuffer: GPUBuffer | null;
  readonly selectionAntsPhasePx: number;
  readonly state: DocumentEditingOverlayState;
}

export class DocumentEditingOverlayRenderer {
  private vectorBackend: VectorEditingOverlayBackend | null = null;
  private textBackend: TextEditingOverlayBackend | null = null;
  private selectionContourBackend: SelectionContourOverlayBackend | null = null;
  private selectionPaintBackend: SelectionPaintOverlayBackend | null = null;
  private smartSelectionBackend: SmartSelectionOverlayBackend | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly canvasFormat: GPUTextureFormat
  ) {}

  setSmartSelectionPreview(mask: RasterSelectionMask | null): boolean {
    if (!mask && !this.smartSelectionBackend) return false;
    this.smartSelectionBackend ??= new SmartSelectionOverlayBackend(
      this.device,
      this.canvasFormat
    );
    this.smartSelectionBackend.setMask(mask);
    return true;
  }

  clearDocument(): void {
    this.smartSelectionBackend?.setMask(null);
  }

  notifySubmitted(): void {
    void this.vectorBackend?.notifySubmitted();
    void this.textBackend?.notifySubmitted();
  }

  estimatedBytes(): number {
    return this.vectorBackend?.cacheMetrics().bytes ?? 0;
  }

  dispose(): void {
    const failures: unknown[] = [];
    const dispose = (operation: () => void) => {
      try { operation(); } catch (reason) { failures.push(reason); }
    };
    dispose(() => this.vectorBackend?.dispose());
    dispose(() => this.textBackend?.dispose());
    dispose(() => this.selectionContourBackend?.dispose());
    dispose(() => this.selectionPaintBackend?.dispose());
    dispose(() => this.smartSelectionBackend?.dispose());
    this.vectorBackend = null;
    this.textBackend = null;
    this.selectionContourBackend = null;
    this.selectionPaintBackend = null;
    this.smartSelectionBackend = null;
    if (failures.length) throw new AggregateError(failures);
  }

  encode({
    encoder,
    canvasView,
    document,
    viewport,
    selectionMask,
    selectionTransformPreviewActive,
    sampler,
    viewBuffer,
    selectionAntsPhasePx,
    state
  }: EditingOverlayEncodeInput): void {
    const canonicalScene = state.resolveVectorScene(document);
    const overlayScene = state.vectorSelectionPreviewTransform
      ? transformVectorDocumentEditingSceneOverlay(
          canonicalScene,
          state.vectorSelectionPreviewTransform
        )
      : canonicalScene;
    const directShape = state.selectionVisible
      && state.selectionPreviewProjectionActive
      && !state.selectionPaintVisible
      && !selectionTransformPreviewActive
      ? directSelectionShape(state.selectionOperations)
      : null;
    const selectionShape = (
      state.selectionPreviewProjectionActive
      || directShape?.points.every((point) => (
        point.x >= 0 && point.y >= 0
        && point.x <= document.width && point.y <= document.height
      ))
    ) ? directShape : null;
    const selectionDraft = state.selectionVisible ? state.selectionDraft : null;
    const mask = state.selectionVisible && !selectionShape ? selectionMask : null;
    if (!overlayScene.paths.length
      && !overlayScene.unpaintedElementOutlines.length
      && !overlayScene.gradientHandles.length
      && !overlayScene.selectionFrame
      && !selectionShape
      && !selectionDraft
      && !state.zoomDraft
      && !mask
      && !this.smartSelectionBackend?.visible
      && !state.transformFrame
      && !state.smartGuideFrame
      && !state.documentGuideFrame
      && !state.documentGridFrame
      && !state.brushCursor
      && !state.penOverlay
      && !state.faceWarpOverlay
      && !state.penRubberBand
      && !state.textOverlay) return;

    const uniforms = viewport.uniforms;
    const target: VectorEditingOverlayTarget = {
      colorView: canvasView,
      format: this.canvasFormat,
      width: viewport.pixelWidth,
      height: viewport.pixelHeight,
      documentToViewport: {
        a: uniforms[4] / document.width,
        b: 0,
        c: 0,
        d: uniforms[5] / document.height,
        tx: uniforms[2],
        ty: uniforms[3]
      }
    };
    const animatedSelectionTheme = {
      ...SELECTION_OUTLINE_THEME,
      dashOffsetPx: selectionAntsPhasePx
    };
    this.vectorBackend ??= new VectorEditingOverlayBackend(this.device);
    for (let index = overlayScene.unpaintedElementOutlines.length - 1; index >= 0; index -= 1) {
      this.vectorBackend.encode(
        encoder,
        overlayScene.unpaintedElementOutlines[index]!,
        target,
        UNPAINTED_ELEMENT_OUTLINE_THEME
      );
    }
    for (let index = overlayScene.paths.length - 1; index >= 0; index -= 1) {
      this.vectorBackend.encode(encoder, overlayScene.paths[index]!, target);
    }
    for (const overlay of overlayScene.gradientHandles) {
      this.vectorBackend.encode(encoder, overlay, target, GRADIENT_GIZMO_THEME);
    }
    if (state.penOverlay) this.vectorBackend.encode(encoder, state.penOverlay, target);
    if (state.faceWarpOverlay) {
      this.vectorBackend.encodeIsolated(
        encoder,
        state.faceWarpOverlay,
        target,
        FACE_WARP_MESH_THEME,
        0.5
      );
    }
    if (state.penRubberBand) {
      const band = state.penRubberBand;
      const overlay: VectorEditingOverlay = {
        pathId: 'pen-rubber-band',
        resourceKey: `pen-rubber-band:${band.from.x}:${band.from.y}:${band.to.x}:${band.to.y}`,
        geometryRevision: 0,
        transformRevision: 0,
        cubics: [{
          subpathId: 'pen-rubber-band', segmentIndex: 0,
          p0: band.from, p1: band.from, p2: band.to, p3: band.to
        }],
        anchors: [],
        handles: []
      };
      this.vectorBackend.encode(encoder, overlay, target);
    }
    if (overlayScene.selectionFrame) {
      this.vectorBackend.encodeSelectionFrame(encoder, overlayScene.selectionFrame, target);
    }
    if (state.transformFrame) {
      this.vectorBackend.encodeTransformFrame(encoder, state.transformFrame, target);
    }
    if (state.smartGuideFrame) {
      this.vectorBackend.encodeSmartGuideFrame(encoder, state.smartGuideFrame, target);
    }
    if (state.documentGridFrame) {
      this.vectorBackend.encodeDocumentGridFrame(encoder, state.documentGridFrame, target);
    }
    if (state.documentGuideFrame) {
      this.vectorBackend.encodeDocumentGuideFrame(encoder, state.documentGuideFrame, target);
    }
    if (selectionShape) {
      this.vectorBackend.encode(
        encoder,
        buildSelectionEditingOverlay(selectionShape, 'committed'),
        target,
        animatedSelectionTheme
      );
    }
    if (mask && sampler && viewBuffer) {
      if (state.selectionPaintVisible) {
        this.selectionPaintBackend ??= new SelectionPaintOverlayBackend(
          this.device,
          this.canvasFormat
        );
        this.selectionPaintBackend.encode(
          encoder, canvasView, mask, sampler, viewBuffer, state.selectionPaintColor
        );
      } else {
        this.selectionContourBackend ??= new SelectionContourOverlayBackend(
          this.device,
          this.canvasFormat
        );
        this.selectionContourBackend.encode(
          encoder, canvasView, mask, sampler, viewBuffer,
          selectionAntsPhasePx, state.selectionPreviewTranslation
        );
      }
    }
    if (this.smartSelectionBackend?.visible && sampler && viewBuffer) {
      this.smartSelectionBackend.encode(encoder, canvasView, sampler, viewBuffer);
    }
    if (selectionDraft) {
      this.vectorBackend.encode(
        encoder,
        buildSelectionEditingOverlay(selectionDraft, 'draft'),
        target,
        animatedSelectionTheme
      );
    }
    if (state.zoomDraft) {
      this.vectorBackend.encode(
        encoder,
        buildSelectionEditingOverlay(state.zoomDraft, 'draft'),
        target,
        SELECTION_OUTLINE_THEME
      );
    }
    if (state.brushCursor) {
      const cursor = state.brushCursor;
      const theme = state.faceWarpMode === 'relax'
        ? FACE_WARP_RELAX_CURSOR_THEME
        : state.faceWarpMode === 'restore'
          ? FACE_WARP_RESTORE_CURSOR_THEME
          : BRUSH_CURSOR_THEME;
      this.vectorBackend.encode(
        encoder,
        buildBrushCursorEditingOverlay(cursor.center, cursor.diameter, cursor.hardness),
        target,
        theme
      );
      if (cursor.sourceCenter) {
        this.vectorBackend.encode(
          encoder,
          buildSampledBrushSourceEditingOverlay(
            cursor.sourceCenter,
            cursor.diameter,
            cursor.sourceMarkerSize ?? 10
          ),
          target,
          BRUSH_CURSOR_THEME
        );
      }
    }
    if (state.textOverlay) {
      this.textBackend ??= new TextEditingOverlayBackend(this.device);
      this.textBackend.encode(
        encoder,
        state.textOverlay,
        target,
        state.textCaretVisible
      );
    }
  }
}
