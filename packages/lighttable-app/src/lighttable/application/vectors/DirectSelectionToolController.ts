import {
  invertMatrix,
  moveAnchorHandle,
  moveAnchors,
  transformPoint,
  type AnchorReference,
  type PathSelectionTarget,
  type Vec2
} from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  createVectorEditorSelection,
  type VectorAnchorSelectionReference,
  type VectorEditorSelection,
  type VectorPathSelectionReference
} from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import { hitTestVectorDocument, type VectorDocumentHit } from './vectorSceneQueries';

export interface DirectSelectionToolDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface DirectSelectionPointerOptions {
  radius: number;
  additive?: boolean;
}

interface ActiveDirectSelectionGesture {
  documentId: ImageDocument['id'];
  layerId: VectorDocumentHit['layerId'];
  pathId: string;
  inverseDocumentTransform: NonNullable<ReturnType<typeof invertMatrix>>;
  startLocal: Vec2;
  target: Extract<PathSelectionTarget, { kind: 'anchor' | 'handle-in' | 'handle-out' }>;
  anchors: AnchorReference[];
}

const samePath = (left: VectorPathSelectionReference, right: VectorPathSelectionReference) =>
  left.layerId === right.layerId && left.pathId === right.pathId;

const sameAnchor = (
  left: VectorAnchorSelectionReference,
  right: VectorAnchorSelectionReference
) => samePath(left, right)
  && left.subpathId === right.subpathId
  && left.anchorId === right.anchorId;

const cloneSelection = (selection: VectorEditorSelection): VectorEditorSelection => ({
  paths: selection.paths.map((reference) => ({ ...reference })),
  anchors: selection.anchors.map((reference) => ({ ...reference })),
  active: selection.active
    ? { ...selection.active, target: { ...selection.active.target } }
    : null
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
      if (!options.additive) this.dependencies.setSelection(createVectorEditorSelection());
      return false;
    }

    const selection = selectHit(
      cloneSelection(this.dependencies.getSelection()),
      hit,
      Boolean(options.additive)
    );
    this.dependencies.setSelection(selection);
    const target = selection.active?.target;
    if (!target || (target.kind !== 'anchor'
      && target.kind !== 'handle-in'
      && target.kind !== 'handle-out')) return true;

    const inverse = invertMatrix(hit.documentPath.transform);
    if (!inverse || !this.documents.beginPathMutation(hit.layerId, hit.pathId)) return true;
    const anchors = selection.anchors
      .filter((reference) => samePath(reference, hit))
      .map(({ subpathId, anchorId }) => ({ subpathId, anchorId }));
    this.gesture = {
      documentId: document.id,
      layerId: hit.layerId,
      pathId: hit.pathId,
      inverseDocumentTransform: inverse,
      startLocal: transformPoint(inverse, documentPoint),
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
    const local = transformPoint(gesture.inverseDocumentTransform, documentPoint);
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
    if (!this.gesture) return false;
    this.pointerMove(documentPoint);
    this.gesture = null;
    return this.documents.commitPathMutation();
  }

  cancel() {
    if (!this.gesture) return false;
    this.gesture = null;
    return this.documents.cancelPathMutation();
  }

  clearSelection() {
    this.dependencies.setSelection(createVectorEditorSelection());
  }

  dispose() {
    this.cancel();
  }
}
