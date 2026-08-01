import {
  deleteAnchors,
  invertMatrix,
  insertAnchorOnSegment,
  moveAnchors,
  setAnchorMode,
  transformPoint,
  translateVectorPath,
  type AnchorMode,
  type Vec2,
  type VectorIdSource,
  type VectorPath
} from '@lighttable/vector-core';
import {
  createVectorEditorSelection,
  type VectorAnchorSelectionReference,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import type { LayerId } from '../../editor/document/documentTypes';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { VectorDocumentController, type VectorPathEdit } from './VectorDocumentController';
import { vectorPathsTopmostFirst } from './vectorSceneQueries';

export interface VectorSelectionCommandDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

const uuidIds: VectorIdSource = {
  next: (kind) => `${kind}-${crypto.randomUUID()}`
};

const pathKey = (layerId: LayerId, pathId: string) => `${layerId}\0${pathId}`;

const groupAnchorsByPath = (anchors: readonly VectorAnchorSelectionReference[]) => {
  const groups = new Map<string, {
    layerId: LayerId;
    pathId: string;
    anchors: VectorAnchorSelectionReference[];
  }>();
  for (const anchor of anchors) {
    const key = pathKey(anchor.layerId, anchor.pathId);
    const group = groups.get(key) ?? {
      layerId: anchor.layerId,
      pathId: anchor.pathId,
      anchors: []
    };
    group.anchors.push(anchor);
    groups.set(key, group);
  }
  return [...groups.values()];
};

const inverseTransformDelta = (
  transform: Parameters<typeof invertMatrix>[0],
  documentDelta: Vec2
): Vec2 | null => {
  const inverse = invertMatrix(transform);
  if (!inverse) return null;
  const origin = transformPoint(inverse, { x: 0, y: 0 });
  const end = transformPoint(inverse, documentDelta);
  return { x: end.x - origin.x, y: end.y - origin.y };
};

/** Atomic keyboard/menu commands for the transient vector selection. */
export class VectorSelectionCommandController {
  constructor(
    private readonly documents: VectorDocumentController,
    private readonly dependencies: VectorSelectionCommandDependencies,
    private readonly ids: VectorIdSource = uuidIds
  ) {}

  deleteSelection() {
    const selection = this.dependencies.getSelection();
    const anchorGroups = groupAnchorsByPath(selection.anchors);
    const anchorPathKeys = new Set(anchorGroups.map(({ layerId, pathId }) => pathKey(layerId, pathId)));
    const edits: VectorPathEdit[] = anchorGroups.map((group) => ({
      layerId: group.layerId,
      pathId: group.pathId,
      edit: (path) => {
        const edited = deleteAnchors(path, group.anchors);
        return edited.subpaths.length > 0 ? edited : null;
      }
    }));
    for (const path of selection.paths) {
      if (anchorPathKeys.has(pathKey(path.layerId, path.pathId))) continue;
      edits.push({ layerId: path.layerId, pathId: path.pathId, edit: () => null });
    }
    if (!this.documents.editPaths(edits)) return false;
    this.dependencies.setSelection(createVectorEditorSelection());
    return true;
  }

  /** Moves selected paths/anchors by a document-space keyboard nudge. */
  nudgeSelection(documentDelta: Vec2) {
    if (documentDelta.x === 0 && documentDelta.y === 0) return false;
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const selection = this.dependencies.getSelection();
    const selectedPathKeys = new Set(
      selection.paths.map(({ layerId, pathId }) => pathKey(layerId, pathId))
    );
    const resolved = new Map(vectorPathsTopmostFirst(document).map((entry) => [
      pathKey(entry.layerId, entry.pathId),
      entry
    ]));
    const edits: VectorPathEdit[] = [];

    for (const path of selection.paths) {
      const entry = resolved.get(pathKey(path.layerId, path.pathId));
      const localDelta = entry
        ? inverseTransformDelta(entry.layerToDocument, documentDelta)
        : null;
      if (!localDelta) return false;
      edits.push({
        layerId: path.layerId,
        pathId: path.pathId,
        edit: (value) => translateVectorPath(value, localDelta)
      });
    }
    for (const group of groupAnchorsByPath(selection.anchors)) {
      if (selectedPathKeys.has(pathKey(group.layerId, group.pathId))) continue;
      const entry = resolved.get(pathKey(group.layerId, group.pathId));
      const localDelta = entry
        ? inverseTransformDelta(entry.documentPath.transform, documentDelta)
        : null;
      if (!localDelta) return false;
      edits.push({
        layerId: group.layerId,
        pathId: group.pathId,
        edit: (value) => moveAnchors(value, group.anchors, localDelta)
      });
    }
    return this.documents.editPaths(edits);
  }

  setSelectedAnchorMode(mode: AnchorMode) {
    const groups = groupAnchorsByPath(this.dependencies.getSelection().anchors);
    const edits: VectorPathEdit[] = groups.map((group) => ({
      layerId: group.layerId,
      pathId: group.pathId,
      edit: (path) => group.anchors.reduce<VectorPath>(
        (next, anchor) => setAnchorMode(next, anchor, mode),
        path
      )
    }));
    return this.documents.editPaths(edits);
  }

  insertAnchorAtActiveSegment() {
    const selection = this.dependencies.getSelection();
    const active = selection.active;
    if (!active || active.target.kind !== 'segment') return false;
    const target = active.target;
    const anchorId = this.ids.next('anchor');
    let insertedSubpathId: string | null = null;
    const changed = this.documents.editPaths([{
      layerId: active.layerId,
      pathId: active.pathId,
      edit: (path) => {
        let found = false;
        const subpaths = path.subpaths.map((subpath) => {
          if (subpath.id !== target.subpathId) return subpath;
          found = true;
          insertedSubpathId = subpath.id;
          return insertAnchorOnSegment(
            subpath,
            target.segmentIndex,
            target.t,
            anchorId
          ).subpath;
        });
        return found ? {
          ...path,
          subpaths,
          geometryRevision: path.geometryRevision + 1
        } : path;
      }
    }]);
    if (!changed || !insertedSubpathId) return false;
    this.dependencies.setSelection({
      paths: [],
      anchors: [{
        layerId: active.layerId,
        pathId: active.pathId,
        subpathId: insertedSubpathId,
        anchorId
      }],
      active: {
        layerId: active.layerId,
        pathId: active.pathId,
        target: { kind: 'anchor', subpathId: insertedSubpathId, anchorId }
      }
    });
    return true;
  }
}
