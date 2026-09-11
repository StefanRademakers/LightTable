import type { TextEditingOverlay } from '@lighttable/text-rendering';
import type { VectorEditingOverlay, VectorSelectionFrame } from '@lighttable/vector-rendering';
import {
  cloneVectorEditorSelection,
  createVectorEditorSelection,
  vectorEditorSelectionsEqual,
  type VectorEditorSelection
} from '../editor/session/editorSession';
import type { SelectionOperation, SelectionShape } from '../editor/selection/selectionTypes';
import type { AffineMatrix } from '../editor/tools/transform/transformTypes';
import { VectorDocumentEditingSceneCache } from '../application/vectors/vectorEditingOverlay';
import type { ImageDocument } from '../editor/document/documentTypes';

export interface BrushCursorOverlay {
  readonly center: { readonly x: number; readonly y: number };
  readonly diameter: number;
  readonly hardness?: number;
  readonly sourceCenter?: { readonly x: number; readonly y: number };
  readonly sourceMarkerSize?: number;
}

export class DocumentEditingOverlayState {
  vectorSelection: VectorEditorSelection = createVectorEditorSelection();
  vectorSelectionPreviewTransform: AffineMatrix | null = null;
  readonly vectorEditingSceneCache = new VectorDocumentEditingSceneCache();
  selectionOperations: SelectionOperation[] = [];
  selectionPreviewProjectionActive = false;
  selectionPreviewTranslation = { x: 0, y: 0 };
  selectionDraft: SelectionShape | null = null;
  selectionVisible = false;
  selectionPaintVisible = false;
  selectionPaintColor: [number, number, number] = [1, 0, 0];
  zoomDraft: SelectionShape | null = null;
  brushCursor: BrushCursorOverlay | null = null;
  penOverlay: VectorEditingOverlay | null = null;
  faceWarpOverlay: VectorEditingOverlay | null = null;
  faceWarpMode: 'sculpt' | 'relax' | 'restore' | null = null;
  penRubberBand: {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
  } | null = null;
  transformFrame: VectorSelectionFrame | null = null;
  smartGuideFrame: VectorSelectionFrame | null = null;
  documentGuideFrame: VectorSelectionFrame | null = null;
  documentGridFrame: VectorSelectionFrame | null = null;
  textOverlay: TextEditingOverlay | null = null;
  textCaretVisible = true;

  get selectionAntsVisible(): boolean {
    return this.selectionVisible && !this.selectionPaintVisible
      && this.selectionOperations.length > 0;
  }

  resolveVectorScene(document: ImageDocument) {
    return this.vectorEditingSceneCache.resolve(document, this.vectorSelection);
  }

  setVectorSelection(selection: VectorEditorSelection): boolean {
    if (vectorEditorSelectionsEqual(this.vectorSelection, selection)) return false;
    this.vectorSelection = cloneVectorEditorSelection(selection);
    this.vectorSelectionPreviewTransform = null;
    return true;
  }

  setVectorPreviewTransform(matrix: AffineMatrix | null): boolean {
    if (!matrix && !this.vectorSelectionPreviewTransform) return false;
    this.vectorSelectionPreviewTransform = matrix ? { ...matrix } : null;
    return true;
  }

  setSelection(
    operations: readonly SelectionOperation[],
    draft: SelectionShape | null,
    visible: boolean,
    paintOverlay?: { readonly visible: boolean; readonly color: string }
  ): void {
    if (!this.selectionPreviewProjectionActive) {
      this.selectionOperations = cloneSelectionOperations(operations);
    }
    this.selectionDraft = cloneSelectionShape(draft);
    this.selectionVisible = visible;
    this.selectionPaintVisible = paintOverlay?.visible === true;
    const match = paintOverlay?.color.match(/^#([0-9a-f]{6})$/i);
    if (match) {
      const value = Number.parseInt(match[1]!, 16);
      this.selectionPaintColor = [
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255
      ];
    }
  }

  setCommittedSelection(operations: readonly SelectionOperation[]): void {
    this.selectionPreviewProjectionActive = false;
    this.selectionPreviewTranslation = { x: 0, y: 0 };
    this.selectionOperations = cloneSelectionOperations(operations);
  }

  setSelectionPreview(
    operations: readonly SelectionOperation[],
    translation: Readonly<{ x: number; y: number }>
  ): void {
    this.selectionPreviewProjectionActive = true;
    this.selectionPreviewTranslation = { ...translation };
    this.selectionOperations = cloneSelectionOperations(operations);
  }

  setZoomDraft(draft: SelectionShape | null): boolean {
    const currentKey = this.zoomDraft ? JSON.stringify(this.zoomDraft.points) : '';
    const nextKey = draft ? JSON.stringify(draft.points) : '';
    if (currentKey === nextKey) return false;
    this.zoomDraft = draft ? {
      kind: 'rectangle',
      points: draft.points.map((point) => ({ ...point }))
    } : null;
    return true;
  }

  setTextOverlay(overlay: TextEditingOverlay | null, caretVisible: boolean): boolean {
    if (this.textOverlay?.resourceKey === overlay?.resourceKey
      && this.textCaretVisible === caretVisible) return false;
    this.textOverlay = overlay;
    this.textCaretVisible = caretVisible;
    return true;
  }

  setBrushCursor(cursor: BrushCursorOverlay | null): boolean {
    const current = this.brushCursor;
    if (current === null && cursor === null
      || current !== null && cursor !== null
        && current.center.x === cursor.center.x
        && current.center.y === cursor.center.y
        && current.diameter === cursor.diameter
        && current.hardness === cursor.hardness
        && current.sourceCenter?.x === cursor.sourceCenter?.x
        && current.sourceCenter?.y === cursor.sourceCenter?.y
        && current.sourceMarkerSize === cursor.sourceMarkerSize) return false;
    this.brushCursor = cursor ? {
      center: { ...cursor.center },
      diameter: cursor.diameter,
      ...(cursor.hardness !== undefined ? { hardness: cursor.hardness } : {}),
      ...(cursor.sourceCenter ? { sourceCenter: { ...cursor.sourceCenter } } : {}),
      ...(cursor.sourceMarkerSize !== undefined
        ? { sourceMarkerSize: cursor.sourceMarkerSize }
        : {})
    } : null;
    return true;
  }

  setPenRubberBand(band: typeof this.penRubberBand): boolean {
    const current = this.penRubberBand;
    if (current === null && band === null
      || current && band
        && current.from.x === band.from.x && current.from.y === band.from.y
        && current.to.x === band.to.x && current.to.y === band.to.y) return false;
    this.penRubberBand = band ? {
      from: { ...band.from },
      to: { ...band.to }
    } : null;
    return true;
  }

  setResourceOverlay(
    field: 'penOverlay' | 'faceWarpOverlay',
    overlay: VectorEditingOverlay | null
  ): boolean {
    if (this[field]?.resourceKey === overlay?.resourceKey) return false;
    this[field] = overlay;
    if (field === 'faceWarpOverlay' && !overlay) this.faceWarpMode = null;
    return true;
  }

  setFaceWarpMode(mode: typeof this.faceWarpMode): boolean {
    if (this.faceWarpMode === mode) return false;
    this.faceWarpMode = mode;
    return true;
  }

  setFrame(
    field: 'transformFrame' | 'smartGuideFrame' | 'documentGuideFrame' | 'documentGridFrame',
    frame: VectorSelectionFrame | null
  ): boolean {
    if (this[field]?.resourceKey === frame?.resourceKey) return false;
    if (!frame || field === 'documentGuideFrame' || field === 'documentGridFrame') {
      this[field] = frame;
      return true;
    }
    this[field] = {
      ...frame,
      bounds: { ...frame.bounds },
      pivot: { ...frame.pivot },
      edges: frame.edges.map(({ start, end }) => ({
        start: { ...start },
        end: { ...end }
      })),
      handles: field === 'smartGuideFrame' ? [] : frame.handles.map((handle) => ({
        ...handle,
        point: { ...handle.point }
      }))
    };
    return true;
  }

  resetForDocument(): void {
    this.textOverlay = null;
    this.vectorSelectionPreviewTransform = null;
  }

  clear(): void {
    this.vectorSelection = createVectorEditorSelection();
    this.vectorSelectionPreviewTransform = null;
    this.vectorEditingSceneCache.clear();
    this.selectionOperations = [];
    this.selectionPreviewProjectionActive = false;
    this.selectionPreviewTranslation = { x: 0, y: 0 };
    this.selectionDraft = null;
    this.selectionVisible = false;
    this.selectionPaintVisible = false;
    this.textOverlay = null;
    this.textCaretVisible = true;
    this.zoomDraft = null;
    this.brushCursor = null;
    this.penRubberBand = null;
    this.penOverlay = null;
    this.faceWarpOverlay = null;
    this.faceWarpMode = null;
    this.transformFrame = null;
    this.smartGuideFrame = null;
    this.documentGuideFrame = null;
    this.documentGridFrame = null;
  }
}

const cloneSelectionShape = (shape: SelectionShape | null): SelectionShape | null => shape ? {
  ...shape,
  points: shape.points.map((point) => ({ ...point }))
} : null;

const cloneSelectionOperations = (
  operations: readonly SelectionOperation[]
): SelectionOperation[] => operations.map((operation) => ({
  ...operation,
  shape: cloneSelectionShape(operation.shape)!
}));
