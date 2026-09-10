import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionPoint } from '../../../editor/selection/selectionTypes';

interface CommittedSelectionHitSource {
  getSelectionMaskSnapshot(): SelectionMaskSnapshot | null;
}

/** Hit-tests only the exact document-owned mask; provenance is never replayed. */
export const committedSelectionContainsPoint = (
  source: CommittedSelectionHitSource,
  point: SelectionPoint,
): boolean => source.getSelectionMaskSnapshot()?.contains(point.x, point.y) === true;
