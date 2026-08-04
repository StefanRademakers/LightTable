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
  /** Untransformed pixel bounds used as the source domain for projective edits. */
  sourceContentBounds: Rect;
  /** Document-space delta produced by the gizmo. */
  matrix: AffineMatrix;
  /** Explicit document-space cage once corner distortion is active. */
  projectiveQuad: TransformQuad | null;
  sourceKind: 'selection' | 'layer';
  /** Semantic layers preview through the compositor without baking pixels. */
  previewKind: 'raster' | 'semantic';
}

export type TransformQuad = readonly [
  TransformPoint,
  TransformPoint,
  TransformPoint,
  TransformPoint
];

export interface TransformPoint {
  x: number;
  y: number;
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
