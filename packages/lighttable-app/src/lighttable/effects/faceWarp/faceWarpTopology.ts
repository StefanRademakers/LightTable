import type { FaceWarpPoint } from './faceWarpTypes';

export interface FaceWarpNeighbor {
  readonly vertex: number;
  readonly length: number;
}

export interface FaceWarpWeightedNeighbor {
  readonly vertex: number;
  readonly weight: number;
}

export interface FaceWarpTopology {
  readonly key: string;
  readonly adjacency: readonly (readonly FaceWarpNeighbor[])[];
  /** Normalized bounded inverse-edge weights reused by every local solve. */
  readonly laplacianWeights: readonly (readonly FaceWarpWeightedNeighbor[])[];
  readonly boundaryVertices: ReadonlySet<number>;
  readonly featureLoops: Readonly<{
    faceOval: readonly number[];
    leftEye: readonly number[];
    rightEye: readonly number[];
    outerLips: readonly number[];
    innerLips: readonly number[];
  }>;
  readonly symmetry: readonly number[];
}

export const FACE_WARP_COLLAR_SCALE = 1.22;

export const faceWarpCollarPoints = (
  mesh: readonly FaceWarpPoint[],
  boundary: readonly number[]
): readonly FaceWarpPoint[] => {
  const center = boundary.reduce((sum, vertex) => ({
    x: sum.x + mesh[vertex]!.x / Math.max(1, boundary.length),
    y: sum.y + mesh[vertex]!.y / Math.max(1, boundary.length)
  }), { x: 0, y: 0 });
  return boundary.map((vertex) => {
    const inner = mesh[vertex]!;
    return {
      x: center.x + (inner.x - center.x) * FACE_WARP_COLLAR_SCALE,
      y: center.y + (inner.y - center.y) * FACE_WARP_COLLAR_SCALE,
      z: inner.z
    };
  });
};

const FEATURE_LOOPS = {
  faceOval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109],
  leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  rightEye: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  outerLips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402,
    317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415],
  innerLips: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311,
    312, 13, 82, 81, 80, 191]
} as const;

const topologyCache = new Map<string, FaceWarpTopology>();
const CACHE_LIMIT = 8;

const topologyKey = (mesh: readonly FaceWarpPoint[], indices: readonly number[]) => {
  // Edge lengths and the detected symmetry pairing are face-geometry data,
  // not topology-only data. Include the immutable source geometry so a second
  // face (or a redetection) can never inherit the first face's geodesics.
  let hash = 2166136261;
  for (const point of mesh) {
    for (const value of [point.x, point.y, point.z ?? 0]) {
      const quantized = Math.round(value * 1024);
      hash ^= quantized;
      hash = Math.imul(hash, 16777619);
    }
  }
  for (const index of indices) {
    hash ^= index;
    hash = Math.imul(hash, 16777619);
  }
  return `${mesh.length}:${indices.length}:${hash >>> 0}`;
};

const validLoop = (loop: readonly number[], vertexCount: number) =>
  loop.filter((vertex) => vertex >= 0 && vertex < vertexCount);

const symmetryMap = (mesh: readonly FaceWarpPoint[]): number[] => {
  const left = mesh[234] ?? mesh.reduce((best, point) => point.x < best.x ? point : best, mesh[0]!);
  const right = mesh[454] ?? mesh.reduce((best, point) => point.x > best.x ? point : best, mesh[0]!);
  if (!left || !right) return mesh.map((_, index) => index);
  const center = {
    x: (left.x + right.x) * 0.5,
    y: (left.y + right.y) * 0.5
  };
  const axisX = right.x - left.x;
  const axisY = right.y - left.y;
  const axisLength = Math.max(1e-6, Math.hypot(axisX, axisY));
  const horizontal = { x: axisX / axisLength, y: axisY / axisLength };
  const vertical = { x: -horizontal.y, y: horizontal.x };
  const local = mesh.map((point) => ({
    x: (point.x - center.x) * horizontal.x + (point.y - center.y) * horizontal.y,
    y: (point.x - center.x) * vertical.x + (point.y - center.y) * vertical.y,
    z: point.z ?? 0
  }));
  return local.map((point) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    local.forEach((candidate, index) => {
      const distance = (candidate.x + point.x) ** 2
        + (candidate.y - point.y) ** 2
        + (candidate.z - point.z) ** 2 * 0.04;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  });
};

export const faceWarpTopology = (
  mesh: readonly FaceWarpPoint[],
  indices: readonly number[]
): FaceWarpTopology => {
  const key = topologyKey(mesh, indices);
  const cached = topologyCache.get(key);
  if (cached) return cached;
  const neighbors = Array.from({ length: mesh.length }, () => new Map<number, number>());
  const edgeUse = new Map<string, { readonly a: number; readonly b: number; count: number }>();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]];
    if (triangle.some((vertex) => vertex === undefined || vertex < 0 || vertex >= mesh.length)) {
      throw new Error('Face Warp topology contains an out-of-range vertex.');
    }
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge]!;
      const b = triangle[(edge + 1) % 3]!;
      if (a === b) continue;
      const length = Math.hypot(mesh[a]!.x - mesh[b]!.x, mesh[a]!.y - mesh[b]!.y);
      neighbors[a]!.set(b, length);
      neighbors[b]!.set(a, length);
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const edgeKey = `${low}:${high}`;
      const existing = edgeUse.get(edgeKey);
      if (existing) existing.count += 1;
      else edgeUse.set(edgeKey, { a: low, b: high, count: 1 });
    }
  }
  const boundaryVertices = new Set<number>();
  edgeUse.forEach(({ a, b, count }) => {
    if (count === 1) { boundaryVertices.add(a); boundaryVertices.add(b); }
  });
  const adjacency = neighbors.map((entries) => [...entries].map(([vertex, length]) => ({ vertex, length })));
  const laplacianWeights = adjacency.map((entries) => {
    const raw = entries.map(({ vertex, length }) => ({
      vertex,
      weight: 1 / Math.max(1e-4, length)
    }));
    const total = raw.reduce((sum, { weight }) => sum + weight, 0);
    return total > 0
      ? raw.map(({ vertex, weight }) => ({ vertex, weight: weight / total }))
      : raw;
  });
  const result: FaceWarpTopology = {
    key,
    adjacency,
    laplacianWeights,
    boundaryVertices,
    featureLoops: {
      faceOval: validLoop(FEATURE_LOOPS.faceOval, mesh.length),
      leftEye: validLoop(FEATURE_LOOPS.leftEye, mesh.length),
      rightEye: validLoop(FEATURE_LOOPS.rightEye, mesh.length),
      outerLips: validLoop(FEATURE_LOOPS.outerLips, mesh.length),
      innerLips: validLoop(FEATURE_LOOPS.innerLips, mesh.length)
    },
    symmetry: symmetryMap(mesh)
  };
  topologyCache.set(key, result);
  if (topologyCache.size > CACHE_LIMIT) topologyCache.delete(topologyCache.keys().next().value!);
  return result;
};
