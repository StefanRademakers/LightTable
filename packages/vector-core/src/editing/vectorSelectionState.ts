import type { AnchorReference } from './pathMutations';
import type { PathSelectionTarget } from './pathSelection';

export interface VectorSelectionState {
  pathIds: string[];
  anchors: AnchorReference[];
  activeTarget: PathSelectionTarget | null;
}

const anchorKey = ({ subpathId, anchorId }: AnchorReference) => `${subpathId}\0${anchorId}`;

export const emptyVectorSelection = (): VectorSelectionState => ({
  pathIds: [],
  anchors: [],
  activeTarget: null
});

export const selectPath = (
  state: VectorSelectionState,
  pathId: string,
  additive = false
): VectorSelectionState => ({
  pathIds: additive
    ? Array.from(new Set([...state.pathIds, pathId]))
    : [pathId],
  anchors: additive ? state.anchors.map((reference) => ({ ...reference })) : [],
  activeTarget: { kind: 'fill', pathId }
});

export const selectAnchor = (
  state: VectorSelectionState,
  reference: AnchorReference,
  additive = false
): VectorSelectionState => {
  const key = anchorKey(reference);
  const anchors = additive
    ? state.anchors.some((item) => anchorKey(item) === key)
      ? state.anchors.map((item) => ({ ...item }))
      : [...state.anchors.map((item) => ({ ...item })), { ...reference }]
    : [{ ...reference }];
  return {
    pathIds: additive ? [...state.pathIds] : [],
    anchors,
    activeTarget: { kind: 'anchor', ...reference }
  };
};

export const toggleAnchorSelection = (
  state: VectorSelectionState,
  reference: AnchorReference
): VectorSelectionState => {
  const key = anchorKey(reference);
  const selected = state.anchors.some((item) => anchorKey(item) === key);
  const anchors = selected
    ? state.anchors.filter((item) => anchorKey(item) !== key).map((item) => ({ ...item }))
    : [...state.anchors.map((item) => ({ ...item })), { ...reference }];
  return {
    pathIds: [...state.pathIds],
    anchors,
    activeTarget: selected ? null : { kind: 'anchor', ...reference }
  };
};

export const selectHitTarget = (
  state: VectorSelectionState,
  target: PathSelectionTarget | null,
  additive = false
): VectorSelectionState => {
  if (!target) return additive ? state : emptyVectorSelection();
  if (target.kind === 'fill') return selectPath(state, target.pathId, additive);
  if (target.kind === 'anchor') return selectAnchor(state, target, additive);
  return {
    pathIds: additive ? [...state.pathIds] : [],
    anchors: additive ? state.anchors.map((reference) => ({ ...reference })) : [],
    activeTarget: { ...target }
  };
};

