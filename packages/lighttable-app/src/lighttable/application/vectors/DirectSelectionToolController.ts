import {
  invertMatrix,
  moveAnchorHandle,
  moveAnchors,
  moveSegmentPoint,
  transformPoint,
  type AnchorReference,
  type PathSelectionTarget,
  type Rect,
  type Vec2
} from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  cloneVectorEditorSelection,
  createVectorEditorSelection,
  type VectorAnchorSelectionReference,
  type VectorEditorSelection,
  type VectorPathSelectionReference
} from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import {
  hitTestVectorDocument,
  vectorAnchorsInDocumentRect,
  type VectorDocumentHit
} from './vectorSceneQueries';

export interface DirectSelectionToolDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface DirectSelectionPointerOptions {
  radius: number;
  additive?: boolean;
}

interface ActiveAnchorGesture {
  kind: 'anchors';
  documentId: ImageDocument['id'];
  layerId: VectorDocumentHit['layerId'];
  pathId: string;
  inverseDocumentTransform: NonNullable<ReturnType<typeof invertMatrix>>;
  startLocal: Vec2;
  target: Extract<PathSelectionTarget, { kind: 'anchor' | 'handle-in' | 'handle-out' }>;
  anchors: AnchorReference[];
}

interface ActiveMarqueeGesture {
  kind: 'marquee';
  documentId: ImageDocument['id'];
  startDocument: Vec2;
  currentDocument: Vec2;
  openingSelection: VectorEditorSelection;
  additive: boolean;
}

interface ActiveSegmentGesture {
  kind: 'segment';
  documentId: ImageDocument['id'];
  layerId: VectorDocumentHit['layerId'];
  pathId: string;
  inverseDocumentTransform: NonNullable<ReturnType<typeof invertMatrix>>;
  startLocal: Vec2;
  target: Extract<PathSelectionTarget, { kind: 'segment' }>;
}

type ActiveDirectSelectionGesture = ActiveAnchorGesture | ActiveSegmentGesture | ActiveMarqueeGesture;

const samePath = (left: VectorPathSelectionReference, right: VectorPathSelectionReference) =>
  left.layerId === right.layerId && left.pathId === right.pathId;

const sameAnchor = (
  left: VectorAnchorSelectionReference,
  right: VectorAnchorSelectionReference
) => samePath(left, right)
  && left.subpathId === right.subpathId
  && left.anchorId === right.anchorId;

const rectBetween = (start: Vec2, end: Vec2): Rect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y)
});

const selectHit = (
  current: VectorEditorSelection,
  hit: VectorDocumentHit,
  additive: boolean
): VectorEditorSelection => {
  const pathReference: VectorPathSelectionReference = {
    layerId: hit.layerId,
    pathId: hit.pathId
  };
  const active = {
    ...pathReference,
    target: { ...hit.target }
  };

  if (hit.target.kind === 'anchor'
    || hit.target.kind === 'handle-in'
    || hit.target.kind === 'handle-out') {
    const anchorReference: VectorAnchorSelectionReference = {
      ...pathReference,
      subpathId: hit.target.subpathId,
      anchorId: hit.target.anchorId
    };
    const alreadySelected = current.anchors.some((item) => sameAnchor(item, anchorReference));
    if (additive && alreadySelected) {
      return {
        paths: current.paths.map((reference) => ({ ...reference })),
        anchors: current.anchors
          .filter((item) => !sameAnchor(item, anchorReference))
          .map((reference) => ({ ...reference })),
        active: null
      };
    }
    return {
      paths: additive
        ? current.paths.map((reference) => ({ ...reference }))
        : [],
      anchors: additive
        ? [...current.anchors.map((reference) => ({ ...reference })), anchorReference]
        : [anchorReference],
      active
    };
  }

  const paths = additive && current.paths.some((item) => samePath(item, pathReference))
    ? current.paths.filter((item) => !samePath(item, pathReference)).map((item) => ({ ...item }))
    : additive
      ? [...current.paths.map((reference) => ({ ...reference })), pathReference]
      : [pathReference];
  return {
    paths,
    anchors: additive
      ? current.anchors.map((reference) => ({ ...reference }))
      : [],
    active: additive && !paths.some((item) => samePath(item, pathReference)) ? null : active
  };
};

/**
 * Framework-neutral Direct Selection interaction.
 *
 * The host projects pointer positions into document coordinates. This class
 * resolves nested scene transforms once at pointer-down, edits path-local
 * geometry during preview, and delegates history coalescing to the document
 * controller. React and the GPU renderer never become mutation authorities.
 */
export class DirectSelectionToolController {
  private gesture: ActiveDirectSelectionGesture | null = null;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly dependencies: DirectSelectionToolDependencies
  ) {}

  pointerDown(documentPoint: Vec2, options: DirectSelectionPointerOptions) {
    this.cancel();
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const hit = hitTestVectorDocument(document, {
      documentPoint,
      radius: options.radius,
      includeFill: true,
      includeHandles: true
    });
    if (!hit) {
      const openingSelection = cloneVectorEditorSelection(this.dependencies.getSelection());
      if (!options.additive) this.dependencies.setSelection(createVectorEditorSelection());
      this.gesture = {
        kind: 'marquee',
        documentId: document.id,
        startDocument: { ...documentPoint },
        currentDocument: { ...documentPoint },
        openingSelection,
        additive: Boolean(options.additive)
      };
      return true;
    }

    const selection = selectHit(
      cloneVectorEditorSelection(this.dependencies.getSelection()),
      hit,
      Boolean(options.additive)
    );
    this.dependencies.setSelection(selection);
    const target = selection.active?.target;
    if (!target || target.kind === 'fill') return true;

    const inverse = invertMatrix(hit.documentPath.transform);
    if (!inverse || !this.documents.beginPathMutation(hit.layerId, hit.pathId)) return true;
    const startLocal = transformPoint(inverse, documentPoint);
    if (target.kind === 'segment') {
      this.gesture = {
        kind: 'segment',
        documentId: document.id,
        layerId: hit.layerId,
        pathId: hit.pathId,
        inverseDocumentTransform: inverse,
        startLocal,
        target
      };
      return true;
    }
    const anchors = selection.anchors
      .filter((reference) => samePath(reference, hit))
      .map(({ subpathId, anchorId }) => ({ subpathId, anchorId }));
    this.gesture = {
      kind: 'anchors',
      documentId: document.id,
      layerId: hit.layerId,
      pathId: hit.pathId,
      inverseDocumentTransform: inverse,
      startLocal,
      target,
      anchors
    };
    return true;
  }

  pointerMove(documentPoint: Vec2) {
    const gesture = this.gesture;
    if (!gesture || this.dependencies.getDocument()?.id !== gesture.documentId) {
      if (gesture) this.cancel();
      return false;
    }
    if (gesture.kind === 'marquee') {
      gesture.currentDocument = { ...documentPoint };
      const document = this.dependencies.getDocument();
      if (!document) return false;
      const matches = vectorAnchorsInDocumentRect(
        document,
        rectBetween(gesture.startDocument, gesture.currentDocument)
      ).map(({ documentPoint: _documentPoint, ...reference }) => reference);
      const anchors = gesture.additive
        ? [
            ...gesture.openingSelection.anchors.map((reference) => ({ ...reference })),
            ...matches.filter((match) => !gesture.openingSelection.anchors.some(
              (reference) => sameAnchor(reference, match)
            ))
          ]
        : matches;
      this.dependencies.setSelection({
        paths: gesture.additive
          ? gesture.openingSelection.paths.map((reference) => ({ ...reference }))
          : [],
        anchors,
        active: null
      });
      return true;
    }
    const local = transformPoint(gesture.inverseDocumentTransform, documentPoint);
    if (gesture.kind === 'segment') {
      const delta = {
        x: local.x - gesture.startLocal.x,
        y: local.y - gesture.startLocal.y
      };
      return this.documents.previewPathMutation((path) => moveSegmentPoint(
        path,
        gesture.target.subpathId,
        gesture.target.segmentIndex,
        gesture.target.t,
        delta
      ));
    }
    if (gesture.target.kind === 'anchor') {
      const delta = {
        x: local.x - gesture.startLocal.x,
        y: local.y - gesture.startLocal.y
      };
      return this.documents.previewPathMutation((path) => moveAnchors(path, gesture.anchors, delta));
    }
    return this.documents.previewPathMutation((path) => moveAnchorHandle(
      path,
      {
        subpathId: gesture.target.subpathId,
        anchorId: gesture.target.anchorId
      },
      gesture.target.kind === 'handle-in' ? 'in' : 'out',
      local
    ));
  }

  pointerUp(documentPoint: Vec2) {
    const gesture = this.gesture;
    if (!gesture) return false;
    this.pointerMove(documentPoint);
    this.gesture = null;
    if (gesture.kind === 'marquee') return true;
    return this.documents.commitPathMutation();
  }

  cancel() {
    const gesture = this.gesture;
    if (!gesture) return false;
    this.gesture = null;
    if (gesture.kind === 'marquee') {
      if (this.dependencies.getDocument()?.id === gesture.documentId) {
        this.dependencies.setSelection(cloneVectorEditorSelection(gesture.openingSelection));
      }
      return true;
    }
    return this.documents.cancelPathMutation();
  }

  marqueeRect() {
    return this.gesture?.kind === 'marquee'
      ? rectBetween(this.gesture.startDocument, this.gesture.currentDocument)
      : null;
  }

  clearSelection() {
    this.dependencies.setSelection(createVectorEditorSelection());
  }

  dispose() {
    this.cancel();
  }
}
