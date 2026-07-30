import type { LayerId, Rect } from '../../document/documentTypes';
import type { AffineMatrix } from '../../rendering/renderContract';

export type { AffineMatrix } from '../../rendering/renderContract';

export interface TransformSessionState {
  layerId: LayerId;
  /** Visual/core bounds used by the transform gizmo. */
  sourceBounds: Rect;
  /** Full soft coverage used for dirty-region invalidation. */
  supportBounds: Rect;
  /** Authoritative source-to-document matrix at session start. */
  sourceMatrix: AffineMatrix;
  /** Document-space delta produced by the gizmo. */
  matrix: AffineMatrix;
  sourceKind: 'selection' | 'layer';
}

export type TransformHandle =
  | 'body'
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'rotate';
