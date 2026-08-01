export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const multiplyScalar = (value: Vec2, scalar: number): Vec2 => ({
  x: value.x * scalar,
  y: value.y * scalar
});
export const scale = multiplyScalar;
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const lengthSquared = (value: Vec2) => dot(value, value);
export const distanceSquared = (a: Vec2, b: Vec2) => lengthSquared(subtract(a, b));
export const distance = (a: Vec2, b: Vec2) => Math.sqrt(distanceSquared(a, b));
export const normalize = (value: Vec2): Vec2 => {
  const magnitude = Math.sqrt(lengthSquared(value));
  return magnitude > Number.EPSILON
    ? { x: value.x / magnitude, y: value.y / magnitude }
    : { x: 0, y: 0 };
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const rectFromPoints = (points: readonly Vec2[]): Rect | null => {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = minX;
  let maxY = minY;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const unionRects = (left: Rect | null, right: Rect | null): Rect | null => {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
};
