import type { AffineMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';

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

export interface VectorStroke {
  paint: SolidPaint;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dash: number[];
  dashOffset: number;
}

export interface VectorStyle {
  fill: SolidPaint | null;
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

export interface CubicSegment {
  startAnchorId: VectorId;
  endAnchorId: VectorId;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}
