import type { AffineMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import type { GradientPaintInstance } from '@lighttable/paint-core';

export type VectorId = string;
export type FillRule = 'nonzero' | 'evenodd';
export type AnchorMode = 'corner' | 'smooth' | 'symmetric';

export interface VectorAnchor {
  id: VectorId;
  position: Vec2;
  /** Absolute position in the same local coordinate space as `position`. */
  handleIn: Vec2 | null;
  /** Absolute position in the same local coordinate space as `position`. */
  handleOut: Vec2 | null;
  mode: AnchorMode;
}

export interface VectorSubpath {
  id: VectorId;
  closed: boolean;
  anchors: VectorAnchor[];
}

export interface SolidPaint {
  type: 'solid';
  color: readonly [number, number, number, number];
}

export type VectorPaint = SolidPaint | GradientPaintInstance;

export interface VectorStroke {
  paint: VectorPaint;
  width: number;
  /** Center is the PDF/default stroke model; inside/outside apply to closed contours. */
  alignment?: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dash: number[];
  dashOffset: number;
}

export interface VectorStyle {
  fill: VectorPaint | null;
  stroke: VectorStroke | null;
  opacity: number;
}

export interface VectorPath {
  id: VectorId;
  type: 'path';
  name: string;
  subpaths: VectorSubpath[];
  fillRule: FillRule;
  transform: AffineMatrix;
  style: VectorStyle;
  geometryRevision: number;
  transformRevision: number;
  styleRevision: number;
}

export interface RectangleShapeGeometry {
  kind: 'rectangle';
  width: number;
  height: number;
  /** Top-left, top-right, bottom-right and bottom-left radii. */
  cornerRadii: [number, number, number, number];
  linkedCorners: boolean;
}

export interface EllipseShapeGeometry {
  kind: 'ellipse';
  width: number;
  height: number;
}

export interface TriangleShapeGeometry {
  kind: 'triangle';
  width: number;
  height: number;
  cornerRadius: number;
}

export interface PolygonShapeGeometry {
  kind: 'polygon';
  sides: number;
  radius: number;
  rotationRadians: number;
  cornerRadius: number;
}

export interface StarShapeGeometry {
  kind: 'star';
  points: number;
  outerRadius: number;
  innerRadius: number;
  rotationRadians: number;
  cornerRadius: number;
}

export interface ArrowheadGeometry {
  width: number;
  length: number;
  concavity: number;
}

export interface LineShapeGeometry {
  kind: 'line';
  start: Vec2;
  end: Vec2;
  startArrow: ArrowheadGeometry | null;
  endArrow: ArrowheadGeometry | null;
}

export type LiveShapeGeometry =
  | RectangleShapeGeometry
  | EllipseShapeGeometry
  | TriangleShapeGeometry
  | PolygonShapeGeometry
  | StarShapeGeometry
  | LineShapeGeometry;

/**
 * Editable parametric geometry. Rendering derives a VectorPath from this data;
 * the derived anchors are deliberately not serialization authority.
 */
export interface VectorLiveShape {
  id: VectorId;
  type: 'live-shape';
  name: string;
  geometry: LiveShapeGeometry;
  transform: AffineMatrix;
  style: VectorStyle;
  geometryRevision: number;
  transformRevision: number;
  styleRevision: number;
}

export type VectorElement = VectorPath | VectorLiveShape;

export interface CubicSegment {
  startAnchorId: VectorId;
  endAnchorId: VectorId;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}
