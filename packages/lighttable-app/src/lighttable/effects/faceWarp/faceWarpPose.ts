import { MEDIAPIPE_FACE_CANONICAL_POSITIONS } from './canonicalFaceTopology';

const normalAt = (a: number, b: number, c: number) => {
  const p = MEDIAPIPE_FACE_CANONICAL_POSITIONS;
  const values = [a, b, c].flatMap((index) => p.slice(index * 3, index * 3 + 3));
  if (values.length !== 9 || values.some((value) => value === undefined)) return null;
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = values as number[];
  const ux = bx! - ax!; const uy = by! - ay!; const uz = bz! - az!;
  const vx = cx! - ax!; const vy = cy! - ay!; const vz = cz! - az!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 1e-8 ? { x: nx / length, y: ny / length, z: nz / length } : null;
};

/** Uses MediaPipe's row-major canonical-to-runtime pose and +Z camera-facing normals. */
export const canonicalTriangleCameraFacing = (
  pose: readonly number[] | undefined,
  a: number,
  b: number,
  c: number
): boolean | null => {
  if (!pose || pose.length !== 16 || pose.some((value) => !Number.isFinite(value))) return null;
  const normal = normalAt(a, b, c);
  if (!normal) return null;
  const x = pose[0]! * normal.x + pose[1]! * normal.y + pose[2]! * normal.z;
  const y = pose[4]! * normal.x + pose[5]! * normal.y + pose[6]! * normal.z;
  const z = pose[8]! * normal.x + pose[9]! * normal.y + pose[10]! * normal.z;
  const length = Math.hypot(x, y, z);
  return length > 1e-8 ? z / length > 0.015 : null;
};

/** Absolute yaw in degrees from MediaPipe's row-major canonical pose. */
export const facePoseYawDegrees = (pose: readonly number[] | undefined): number | null => {
  if (!pose || pose.length !== 16 || pose.some((value) => !Number.isFinite(value))) return null;
  const xLength = Math.hypot(pose[0]!, pose[4]!, pose[8]!);
  if (xLength <= 1e-8) return null;
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, -pose[8]! / xLength)))) * 180 / Math.PI;
};
