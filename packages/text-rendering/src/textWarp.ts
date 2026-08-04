import type { Rect, TextWarp, Vec2 } from '@lighttable/text-core';

const bilinear = (a: number, b: number, c: number, d: number, u: number, v: number) => (
  a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
);

const meshPoint = (warp: TextWarp, u: number, v: number): Vec2 | null => {
  const mesh = warp.mesh;
  if (!mesh) return null;
  const columnPosition = Math.max(0, Math.min(mesh.columns - 1, u * (mesh.columns - 1)));
  const rowPosition = Math.max(0, Math.min(mesh.rows - 1, v * (mesh.rows - 1)));
  const column = Math.min(mesh.columns - 2, Math.floor(columnPosition));
  const row = Math.min(mesh.rows - 2, Math.floor(rowPosition));
  const localU = columnPosition - column;
  const localV = rowPosition - row;
  const point = (r: number, c: number) => mesh.points[r * mesh.columns + c]!;
  const topLeft = point(row, column);
  const topRight = point(row, column + 1);
  const bottomLeft = point(row + 1, column);
  const bottomRight = point(row + 1, column + 1);
  return {
    x: bilinear(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x, localU, localV),
    y: bilinear(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y, localU, localV)
  };
};

/** Maps a layer-local point through the canonical Photoshop-style text envelope. */
export const warpTextPoint = (point: Vec2, warp: TextWarp, fallbackBounds: Rect): Vec2 => {
  const bounds = warp.bounds ?? fallbackBounds;
  if (!(bounds.width > 0) || !(bounds.height > 0)) return { ...point };
  const rawU = (point.x - bounds.x) / bounds.width;
  const rawV = (point.y - bounds.y) / bounds.height;
  const custom = warp.style === 'custom' ? meshPoint(warp, rawU, rawV) : null;
  if (custom) return custom;

  let u = warp.orientation === 'vertical' ? rawV : rawU;
  let v = warp.orientation === 'vertical' ? rawU : rawV;
  const width = warp.orientation === 'vertical' ? bounds.height : bounds.width;
  const height = warp.orientation === 'vertical' ? bounds.width : bounds.height;
  const bend = warp.bend / 100;
  const centeredU = u - 0.5;
  const centeredV = v - 0.5;
  switch (warp.style) {
    case 'arc': v -= Math.sin(Math.PI * u) * bend * 0.5; break;
    case 'arc-lower': v -= Math.sin(Math.PI * u) * bend * Math.max(0, v); break;
    case 'arc-upper': v -= Math.sin(Math.PI * u) * bend * Math.max(0, 1 - v); break;
    case 'arch': v -= (1 - 4 * centeredU * centeredU) * bend * 0.5; break;
    case 'bulge': u += centeredU * (1 - 4 * centeredV * centeredV) * bend * 0.5; break;
    case 'shell-lower': v -= (u * u - u) * bend; break;
    case 'shell-upper': v += (u * u - u) * bend; break;
    case 'flag': v += Math.sin(u * Math.PI * 2) * bend * 0.25; break;
    case 'wave': v += Math.sin(u * Math.PI * 2) * bend * (0.15 + 0.2 * v); break;
    case 'fish': u += (1 - 4 * centeredV * centeredV) * bend * 0.25 * (1 - u); break;
    case 'rise': v -= u * bend * 0.5; break;
    case 'fisheye': {
      const scale = 1 + bend * (1 - Math.min(1, 4 * (centeredU ** 2 + centeredV ** 2))) * 0.5;
      u = 0.5 + centeredU * scale; v = 0.5 + centeredV * scale; break;
    }
    case 'inflate': {
      const scale = 1 + bend * (1 - 4 * centeredV * centeredV) * 0.35;
      u = 0.5 + centeredU * scale; break;
    }
    case 'squeeze': u = 0.5 + centeredU * (1 - bend * (1 - 4 * centeredV * centeredV) * 0.55); break;
    case 'twist': {
      const angle = bend * Math.PI * (1 - Math.min(1, Math.hypot(centeredU, centeredV) * 2));
      u = 0.5 + centeredU * Math.cos(angle) - centeredV * Math.sin(angle);
      v = 0.5 + centeredU * Math.sin(angle) + centeredV * Math.cos(angle); break;
    }
    case 'cylinder': u = 0.5 + Math.sin(centeredU * Math.PI) * 0.5 * (1 + bend * 0.5); break;
    case 'custom': break;
  }
  u += (warp.horizontalDistortion / 100) * centeredV * 0.5;
  v += (warp.verticalDistortion / 100) * centeredU * 0.5;
  return warp.orientation === 'vertical'
    ? { x: bounds.x + v * height, y: bounds.y + u * width }
    : { x: bounds.x + u * width, y: bounds.y + v * height };
};

/** Numerically inverts the authored envelope for caret hit-testing without raster readback. */
export const unwarpTextPoint = (
  point: Vec2,
  warp: TextWarp,
  fallbackBounds: Rect
): Vec2 | null => {
  const bounds = warp.bounds ?? fallbackBounds;
  if (!(bounds.width > 0) || !(bounds.height > 0)) return { ...point };
  let candidate = { ...point };
  const epsilonX = Math.max(1e-4, Math.abs(bounds.width) * 1e-5);
  const epsilonY = Math.max(1e-4, Math.abs(bounds.height) * 1e-5);
  const tolerance = Math.max(1e-4, Math.max(bounds.width, bounds.height) * 1e-6);
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const mapped = warpTextPoint(candidate, warp, fallbackBounds);
    const errorX = mapped.x - point.x;
    const errorY = mapped.y - point.y;
    if (Math.hypot(errorX, errorY) <= tolerance) return candidate;
    const mappedX = warpTextPoint({ x: candidate.x + epsilonX, y: candidate.y }, warp, fallbackBounds);
    const mappedY = warpTextPoint({ x: candidate.x, y: candidate.y + epsilonY }, warp, fallbackBounds);
    const j00 = (mappedX.x - mapped.x) / epsilonX;
    const j10 = (mappedX.y - mapped.y) / epsilonX;
    const j01 = (mappedY.x - mapped.x) / epsilonY;
    const j11 = (mappedY.y - mapped.y) / epsilonY;
    const determinant = j00 * j11 - j01 * j10;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null;
    candidate = {
      x: candidate.x - (j11 * errorX - j01 * errorY) / determinant,
      y: candidate.y - (-j10 * errorX + j00 * errorY) / determinant
    };
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return null;
  }
  const residual = warpTextPoint(candidate, warp, fallbackBounds);
  return Math.hypot(residual.x - point.x, residual.y - point.y) <= tolerance * 4
    ? candidate
    : null;
};
