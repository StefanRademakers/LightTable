import type { FaceWarpFace, FaceWarpParameters, FaceWarpPoint } from './faceWarpTypes';
import { preventIncrementalTriangleFoldovers } from '../deformation/deformationStability';
import {
  faceWarpCollarPoints,
  faceWarpTopology,
  type FaceWarpNeighbor
} from './faceWarpTopology';

interface Basis {
  readonly center: FaceWarpPoint;
  readonly horizontal: readonly [number, number];
  readonly vertical: readonly [number, number];
  readonly width: number;
  readonly height: number;
}

const unit = (x: number, y: number): readonly [number, number] => {
  const length = Math.max(Math.hypot(x, y), 1e-6);
  return [x / length, y / length];
};

const faceBasis = (face: FaceWarpFace): Basis => {
  const { landmarks } = face;
  const horizontal = unit(
    landmarks.rightCheek.x - landmarks.leftCheek.x,
    landmarks.rightCheek.y - landmarks.leftCheek.y
  );
  let vertical = unit(
    landmarks.chin.x - landmarks.faceTop.x,
    landmarks.chin.y - landmarks.faceTop.y
  );
  const projection = vertical[0] * horizontal[0] + vertical[1] * horizontal[1];
  vertical = unit(
    vertical[0] - projection * horizontal[0],
    vertical[1] - projection * horizontal[1]
  );
  const height = Math.max(2, Math.hypot(
    landmarks.chin.x - landmarks.faceTop.x,
    landmarks.chin.y - landmarks.faceTop.y
  ));
  return {
    center: {
      x: (landmarks.noseTop.x + landmarks.noseTip.x) * 0.5,
      y: (landmarks.noseTop.y + landmarks.noseTip.y) * 0.5
    },
    horizontal,
    vertical,
    // A profile collapses the projected cheek distance. Keeping a conservative
    // height-derived floor prevents identical slider values from becoming
    // several times stronger merely because the head is turned.
    width: Math.max(2, height * 0.55, Math.hypot(
      landmarks.rightCheek.x - landmarks.leftCheek.x,
      landmarks.rightCheek.y - landmarks.leftCheek.y
    )),
    height
  };
};

const local = (point: FaceWarpPoint, basis: Basis) => ({
  x: (point.x - basis.center.x) * basis.horizontal[0]
    + (point.y - basis.center.y) * basis.horizontal[1],
  y: (point.x - basis.center.x) * basis.vertical[0]
    + (point.y - basis.center.y) * basis.vertical[1]
});

const smoothWeight = (distance: number, radius: number): number => {
  const t = Math.max(0, Math.min(1, 1 - distance / Math.max(radius, 1e-6)));
  // Quintic smootherstep has zero first and second derivatives at both ends.
  // That matters on a visible face lattice: a cubic falloff leaves a subtle
  // ring/kink where the brush influence reaches zero.
  return t * t * t * (t * (t * 6 - 15) + 10);
};

interface DistanceQueueEntry { readonly vertex: number; readonly distance: number }

const pushDistance = (heap: DistanceQueueEntry[], entry: DistanceQueueEntry) => {
  heap.push(entry);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (heap[parent]!.distance <= entry.distance) break;
    heap[child] = heap[parent]!;
    child = parent;
  }
  heap[child] = entry;
};

const popDistance = (heap: DistanceQueueEntry[]): DistanceQueueEntry | null => {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first ?? null;
  let parent = 0;
  while (true) {
    const left = parent * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.distance < heap[left]!.distance ? right : left;
    if (heap[child]!.distance >= last.distance) break;
    heap[parent] = heap[child]!;
    parent = child;
  }
  heap[parent] = last;
  return first;
};

const addLocal = (
  target: { x: number; y: number }, basis: Basis,
  dx: number, dy: number, weight = 1
) => {
  target.x += (basis.horizontal[0] * dx + basis.vertical[0] * dy) * weight;
  target.y += (basis.horizontal[1] * dx + basis.vertical[1] * dy) * weight;
};

/** Builds the target lattice shared by the renderer and editing overlay. */
const geodesicDistances = (
  mesh: readonly FaceWarpPoint[],
  adjacency: readonly (readonly FaceWarpNeighbor[])[],
  center: FaceWarpPoint,
  radius: number
) => {
  let origin = 0;
  let nearest = Number.POSITIVE_INFINITY;
  mesh.forEach((point, index) => {
    const candidate = Math.hypot(point.x - center.x, point.y - center.y);
    if (candidate < nearest) { nearest = candidate; origin = index; }
  });
  const distances = new Float64Array(mesh.length);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[origin] = nearest;
  const queue: DistanceQueueEntry[] = [{ vertex: origin, distance: nearest }];
  while (queue.length > 0) {
    const current = popDistance(queue)!;
    if (current.distance !== distances[current.vertex] || current.distance > radius) continue;
    for (const neighbor of adjacency[current.vertex]!) {
      const candidate = current.distance + neighbor.length;
      if (candidate >= distances[neighbor.vertex]! || candidate > radius) continue;
      distances[neighbor.vertex] = candidate;
      pushDistance(queue, { vertex: neighbor.vertex, distance: candidate });
    }
  }
  return distances;
};

/**
 * Validates both the observed facial surface and its pinned transition ring.
 * Checking only MediaPipe's triangles allows a valid face to pull its collar
 * through itself, which renders as long texture ribbons outside the face.
 */
const preventFaceAndCollarFoldovers = (
  face: FaceWarpFace,
  accepted: readonly FaceWarpPoint[],
  desired: readonly FaceWarpPoint[],
  triangleIndices: readonly number[]
): FaceWarpPoint[] => {
  const source = face.landmarks.mesh;
  const boundary = faceWarpTopology(source, triangleIndices).featureLoops.faceOval;
  if (boundary.length < 3) {
    return preventIncrementalTriangleFoldovers(source, accepted, desired, triangleIndices);
  }
  const collar = faceWarpCollarPoints(source, boundary);
  const offset = source.length;
  const guardedIndices = [...triangleIndices];
  boundary.forEach((vertex, boundaryIndex) => {
    const nextIndex = (boundaryIndex + 1) % boundary.length;
    const nextVertex = boundary[nextIndex]!;
    const outer = offset + boundaryIndex;
    const nextOuter = offset + nextIndex;
    guardedIndices.push(vertex, nextVertex, outer, nextVertex, nextOuter, outer);
  });
  const guarded = preventIncrementalTriangleFoldovers(
    [...source, ...collar],
    [...accepted, ...collar],
    [...desired, ...collar],
    guardedIndices
  );
  return guarded.slice(0, source.length);
};

export const deformFaceMesh = (
  face: FaceWarpFace,
  _triangleIndices: readonly number[] = []
): FaceWarpPoint[] => {
  const basis = faceBasis(face);
  const p = face.parameters;
  const landmarks = face.landmarks;
  const targetMesh: FaceWarpPoint[] = landmarks.mesh.map((source, sourceIndex) => {
    const target = { x: source.x, y: source.y, z: source.z };
    const q = local(source, basis);
    const nx = q.x / (basis.width * 0.5);
    const ny = q.y / (basis.height * 0.5);
    const faceEnvelope = smoothWeight(Math.hypot(nx * 0.55, ny * 0.32), 1);
    addLocal(target, basis, nx * basis.width * 0.12 * p.faceWidth, 0, faceEnvelope);
    addLocal(target, basis, 0, -basis.height * 0.1 * p.foreheadHeight,
      smoothWeight(Math.hypot(nx, ny + 0.72), 0.7));
    addLocal(target, basis, nx * basis.width * 0.08 * p.jaw,
      basis.height * 0.07 * p.jaw,
      smoothWeight(Math.hypot(nx, ny - 0.62), 0.72));

    const featureScale = (
      center: FaceWarpPoint, radiusX: number, radiusY: number,
      scaleX: number, scaleY: number, translateX = 0, translateY = 0
    ) => {
      const c = local(center, basis);
      const dx = q.x - c.x;
      const dy = q.y - c.y;
      const weight = smoothWeight(Math.hypot(dx / radiusX, dy / radiusY), 1);
      addLocal(target, basis,
        (dx * scaleX + translateX) * weight,
        (dy * scaleY + translateY) * weight);
    };

    const eyeRadiusX = basis.width * 0.19;
    const eyeRadiusY = basis.height * 0.13;
    const side = Math.sign(q.x) || 1;
    featureScale(landmarks.leftEye, eyeRadiusX, eyeRadiusY,
      p.eyeSize * 0.22 + p.eyeWidth * 0.18,
      p.eyeSize * 0.22 + p.eyeHeight * 0.2,
      -basis.width * 0.035 * p.eyeSpacing,
      -side * basis.height * 0.012 * p.eyeTilt);
    featureScale(landmarks.rightEye, eyeRadiusX, eyeRadiusY,
      p.eyeSize * 0.22 + p.eyeWidth * 0.18,
      p.eyeSize * 0.22 + p.eyeHeight * 0.2,
      basis.width * 0.035 * p.eyeSpacing,
      side * basis.height * 0.012 * p.eyeTilt);
    featureScale(landmarks.noseTip, basis.width * 0.18, basis.height * 0.25,
      p.noseWidth * 0.24, p.noseHeight * 0.18);
    featureScale(landmarks.mouthTop, basis.width * 0.3, basis.height * 0.2,
      p.mouthWidth * 0.22, p.mouthHeight * 0.2);
    const mouthCenter = local(landmarks.mouthTop, basis);
    const mouthDx = q.x - mouthCenter.x;
    const mouthDy = q.y - mouthCenter.y;
    const mouthWeight = smoothWeight(Math.hypot(
      mouthDx / (basis.width * 0.3), mouthDy / (basis.height * 0.2)
    ), 1);
    const cornerWeight = Math.min(1, Math.abs(mouthDx) / (basis.width * 0.18));
    // Smile is a relative morph: move the corners up and slightly outward,
    // without translating the complete mouth or erasing the source expression.
    addLocal(target, basis,
      Math.sign(mouthDx) * basis.width * 0.012 * p.smile * cornerWeight,
      -basis.height * 0.045 * p.smile * cornerWeight,
      mouthWeight);

    const displacement = face.displacements?.[sourceIndex];
    if (displacement) {
      target.x += displacement.x;
      target.y += displacement.y;
    }
    return target;
  });
  return targetMesh;
};

/** Applies a semantic morph without invalidating an already accepted mesh. */
export const applyFaceWarpParameterChange = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  change: Partial<FaceWarpParameters>
): FaceWarpFace => {
  const boundedChange = Object.fromEntries(Object.entries(change).map(([key, value]) => [
    key,
    Math.max(-1, Math.min(1, Number.isFinite(value) ? value! : 0))
  ])) as Partial<FaceWarpParameters>;
  const parameters = { ...face.parameters, ...boundedChange };
  const desiredFace = { ...face, parameters };
  if (triangleIndices.length === 0) return desiredFace;
  const source = face.landmarks.mesh;
  const accepted = deformFaceMesh(face);
  const desired = deformFaceMesh(desiredFace);
  const safe = preventFaceAndCollarFoldovers(face, accepted, desired, triangleIndices);
  const semanticTarget = deformFaceMesh({ ...desiredFace, displacements: [] });
  return {
    ...desiredFace,
    displacements: safe.map((point, index) => ({
      x: point.x - semanticTarget[index]!.x,
      y: point.y - semanticTarget[index]!.y
    }))
  };
};

/** Blender-style compact proportional editing over the detected mesh. */
export const applyFaceWarpBrush = (
  face: FaceWarpFace, triangleIndices: readonly number[],
  center: FaceWarpPoint, delta: FaceWarpPoint,
  radius: number, strength: number,
  solverIterations = 2
): readonly FaceWarpPoint[] => {
  const source = face.landmarks.mesh;
  const current = source.map((_, index) => face.displacements?.[index] ?? { x: 0, y: 0 });
  if (Math.hypot(delta.x, delta.y) <= 1e-4) return current;
  const distances = triangleIndices.length > 0
    ? geodesicDistances(source, faceWarpTopology(source, triangleIndices).adjacency, center, radius)
    : source.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const influence = current.map((_, index) => smoothWeight(distances[index]!, radius));
  const direct = current.map((value, index) => {
    const weight = influence[index]! * strength;
    return { x: value.x + delta.x * weight, y: value.y + delta.y * weight };
  });
  const laplacianWeights = triangleIndices.length > 0
    ? faceWarpTopology(source, triangleIndices).laplacianWeights
    : [];
  // Two bounded Jacobi steps regularize the displacement field while strong
  // central constraints continue to follow the pointer. This is deliberately
  // small and deterministic for the one-frame preview path.
  let desiredDisplacements = direct;
  for (let iteration = 0; iteration < solverIterations && laplacianWeights.length > 0; iteration += 1) {
    const previous = desiredDisplacements;
    desiredDisplacements = previous.map((value, index) => {
      const weight = influence[index]!;
      if (weight <= 0 || weight >= 0.92) return value;
      const neighbors = laplacianWeights[index]!;
      if (neighbors.length === 0) return value;
      const average = neighbors.reduce((sum, neighbor) => {
        return {
          x: sum.x + previous[neighbor.vertex]!.x * neighbor.weight,
          y: sum.y + previous[neighbor.vertex]!.y * neighbor.weight
        };
      }, { x: 0, y: 0 });
      const regularization = 0.42 * (1 - weight);
      return {
        x: direct[index]!.x + (average.x - direct[index]!.x) * regularization,
        y: direct[index]!.y + (average.y - direct[index]!.y) * regularization
      };
    });
  }
  if (triangleIndices.length === 0) return desiredDisplacements;
  const withoutDisplacements = { ...face, displacements: [] };
  const semanticTarget = deformFaceMesh(withoutDisplacements);
  const acceptedTarget = deformFaceMesh({ ...face, displacements: current });
  const desiredTarget = deformFaceMesh({ ...face, displacements: desiredDisplacements });
  const safeTarget = preventFaceAndCollarFoldovers(
    face, acceptedTarget, desiredTarget, triangleIndices
  );
  return safeTarget.map((point, index) => ({
    x: point.x - semanticTarget[index]!.x,
    y: point.y - semanticTarget[index]!.y
  }));
};

/**
 * Converges the cheap interactive brush preview after pointer-up.
 *
 * The authored preview is the data term: the brush core stays pinned and the
 * transition band is regularized over mesh connectivity. Vertices belonging
 * to an eye or lip loop only average with that same loop, preventing the
 * solver from taking a screen-space shortcut across eyelids or the mouth.
 * This function is deliberately pure so refinement can move to a worker
 * without changing document state or renderer contracts.
 */
export const refineFaceWarpBrush = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  center: FaceWarpPoint,
  radius: number,
  maxIterations = 48
): readonly FaceWarpPoint[] => {
  const source = face.landmarks.mesh;
  const authored = source.map((_, index) => face.displacements?.[index] ?? { x: 0, y: 0 });
  if (triangleIndices.length === 0 || maxIterations <= 0) return authored;
  const topology = faceWarpTopology(source, triangleIndices);
  const distances = geodesicDistances(source, topology.adjacency, center, radius);
  const influence = authored.map((_, index) => smoothWeight(distances[index]!, radius));
  const featureMembership = new Int16Array(source.length);
  featureMembership.fill(-1);
  const protectedLoops = [
    topology.featureLoops.leftEye,
    topology.featureLoops.rightEye,
    topology.featureLoops.outerLips,
    topology.featureLoops.innerLips
  ];
  protectedLoops.forEach((loop, loopIndex) => {
    loop.forEach((vertex) => { featureMembership[vertex] = loopIndex; });
  });

  let refined = authored.map((point) => ({ ...point }));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const previous = refined;
    let maximumChange = 0;
    refined = previous.map((value, index) => {
      const localInfluence = influence[index]!;
      // Outside is immutable; the central pointer constraint is exact.
      if (localInfluence <= 0 || localInfluence >= 0.9) return authored[index]!;
      const membership = featureMembership[index]!;
      const candidates = topology.laplacianWeights[index]!.filter(({ vertex }) =>
        membership < 0 || featureMembership[vertex] === membership
      );
      if (candidates.length === 0) return value;
      const total = candidates.reduce((sum, neighbor) => sum + neighbor.weight, 0);
      if (total <= 1e-8) return value;
      const average = candidates.reduce((sum, neighbor) => ({
        x: sum.x + previous[neighbor.vertex]!.x * neighbor.weight / total,
        y: sum.y + previous[neighbor.vertex]!.y * neighbor.weight / total
      }), { x: 0, y: 0 });
      const featureStrength = membership >= 0 ? 0.42 : 1;
      const boundaryStrength = topology.boundaryVertices.has(index) ? 0.2 : 1;
      const smoothing = 0.3 * (1 - localInfluence) * featureStrength * boundaryStrength;
      const next = {
        x: authored[index]!.x + (average.x - authored[index]!.x) * smoothing,
        y: authored[index]!.y + (average.y - authored[index]!.y) * smoothing
      };
      maximumChange = Math.max(maximumChange, Math.hypot(next.x - value.x, next.y - value.y));
      return next;
    });
    if (maximumChange < 1e-4) break;
  }

  const semanticTarget = deformFaceMesh({ ...face, displacements: [] });
  const acceptedTarget = deformFaceMesh(face);
  const desiredTarget = deformFaceMesh({ ...face, displacements: refined });
  const safeTarget = preventFaceAndCollarFoldovers(
    face, acceptedTarget, desiredTarget, triangleIndices
  );
  return safeTarget.map((point, index) => ({
    x: point.x - semanticTarget[index]!.x,
    y: point.y - semanticTarget[index]!.y
  }));
};

const triangleContains = (
  point: FaceWarpPoint,
  a: FaceWarpPoint,
  b: FaceWarpPoint,
  c: FaceWarpPoint
): boolean => {
  const cross = (p: FaceWarpPoint, q: FaceWarpPoint, r: FaceWarpPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ab = cross(a, b, point);
  const bc = cross(b, c, point);
  const ca = cross(c, a, point);
  return !((ab < 0 || bc < 0 || ca < 0) && (ab > 0 || bc > 0 || ca > 0));
};

export interface FaceWarpMeshHit {
  readonly sourcePoint: FaceWarpPoint;
  readonly triangle: readonly [number, number, number];
  readonly barycentric: readonly [number, number, number];
  readonly depth: number;
}

const barycentricCoordinates = (
  point: FaceWarpPoint,
  a: FaceWarpPoint,
  b: FaceWarpPoint,
  c: FaceWarpPoint
): readonly [number, number, number] | null => {
  const denominator = (b.y - c.y) * (a.x - c.x)
    + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-8) return null;
  const u = ((b.y - c.y) * (point.x - c.x)
    + (c.x - b.x) * (point.y - c.y)) / denominator;
  const v = ((c.y - a.y) * (point.x - c.x)
    + (a.x - c.x) * (point.y - c.y)) / denominator;
  return [u, v, 1 - u - v];
};

interface ProjectedFaceTriangle {
  readonly indices: readonly [number, number, number];
  readonly points: readonly [FaceWarpPoint, FaceWarpPoint, FaceWarpPoint];
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const triangleDepthAt = (triangle: ProjectedFaceTriangle, point: FaceWarpPoint): number | null => {
  const barycentric = barycentricCoordinates(point, ...triangle.points);
  if (!barycentric || barycentric.some((weight) => weight < -1e-5)) return null;
  return triangle.points.reduce(
    (depth, vertex, index) => depth + (vertex.z ?? 0) * barycentric[index]!, 0
  );
};

/**
 * Returns the front-most projected triangles of one target mesh. MediaPipe's
 * screen-space depth uses smaller Z values for points nearer the camera. A
 * dominant winding check removes back-facing folds first; a small spatial
 * depth test then removes far-side profile geometry without an O(n^2) scan.
 */
export const visibleFaceTriangleIndices = (
  face: FaceWarpFace,
  triangleIndices: readonly number[]
): readonly number[] => {
  const target = deformFaceMesh(face, triangleIndices);
  const triangles: ProjectedFaceTriangle[] = [];
  let positiveArea = 0;
  let negativeArea = 0;
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const a = target[triangleIndices[index]!];
    const b = target[triangleIndices[index + 1]!];
    const c = target[triangleIndices[index + 2]!];
    if (!a || !b || !c) continue;
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    triangles.push({
      indices: [triangleIndices[index]!, triangleIndices[index + 1]!, triangleIndices[index + 2]!],
      points: [a, b, c], area,
      minX: Math.min(a.x, b.x, c.x), minY: Math.min(a.y, b.y, c.y),
      maxX: Math.max(a.x, b.x, c.x), maxY: Math.max(a.y, b.y, c.y)
    });
    if (area > 0) positiveArea += area;
    else negativeArea -= area;
  }
  const visibleSign = positiveArea >= negativeArea ? 1 : -1;
  const frontFacing = triangles.filter(({ area }) => area * visibleSign > 1e-5);
  if (frontFacing.length === 0) return [];

  const meshWidth = Math.max(...frontFacing.map(({ maxX }) => maxX))
    - Math.min(...frontFacing.map(({ minX }) => minX));
  const meshHeight = Math.max(...frontFacing.map(({ maxY }) => maxY))
    - Math.min(...frontFacing.map(({ minY }) => minY));
  const cellSize = Math.max(8, Math.max(meshWidth, meshHeight) / 24);
  const cellKey = (point: FaceWarpPoint) =>
    `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
  const buckets = new Map<string, number[]>();
  frontFacing.forEach((triangle, triangleIndex) => {
    const minCellX = Math.floor(triangle.minX / cellSize);
    const maxCellX = Math.floor(triangle.maxX / cellSize);
    const minCellY = Math.floor(triangle.minY / cellSize);
    const maxCellY = Math.floor(triangle.maxY / cellSize);
    for (let y = minCellY; y <= maxCellY; y += 1) {
      for (let x = minCellX; x <= maxCellX; x += 1) {
        const key = `${x}:${y}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(triangleIndex);
        buckets.set(key, bucket);
      }
    }
  });

  const visible: number[] = [];
  frontFacing.forEach((triangle, triangleIndex) => {
    const [a, b, c] = triangle.points;
    const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    const samples = [
      center,
      ...triangle.points.map((vertex) => ({
        x: vertex.x * 0.8 + center.x * 0.2,
        y: vertex.y * 0.8 + center.y * 0.2
      }))
    ];
    const hasVisibleSample = samples.some((sample) => {
      const ownDepth = triangleDepthAt(triangle, sample);
      if (ownDepth === null) return false;
      return !(buckets.get(cellKey(sample)) ?? []).some((candidateIndex) => {
        if (candidateIndex === triangleIndex) return false;
        const candidate = frontFacing[candidateIndex]!;
        if (sample.x < candidate.minX || sample.x > candidate.maxX
          || sample.y < candidate.minY || sample.y > candidate.maxY) return false;
        const candidateDepth = triangleDepthAt(candidate, sample);
        return candidateDepth !== null && candidateDepth < ownDepth - 1e-3;
      });
    });
    if (hasVisibleSample) visible.push(...triangle.indices);
  });
  return visible;
};

/**
 * Resolves a target-space pointer to an immutable source-mesh seed. When
 * projected profile triangles overlap, the nearest detector-depth triangle
 * wins instead of letting array order choose the far side of the face.
 */
export const findDeformedFaceHit = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  point: FaceWarpPoint
): FaceWarpMeshHit | null => {
  const source = face.landmarks.mesh;
  const target = deformFaceMesh(face, triangleIndices);
  let best: FaceWarpMeshHit | null = null;
  const visibleTriangles = visibleFaceTriangleIndices(face, triangleIndices);
  for (let index = 0; index < visibleTriangles.length; index += 3) {
    const triangle = [
      visibleTriangles[index]!,
      visibleTriangles[index + 1]!,
      visibleTriangles[index + 2]!
    ] as const;
    const [a, b, c] = triangle.map((vertex) => target[vertex]) as [
      FaceWarpPoint | undefined,
      FaceWarpPoint | undefined,
      FaceWarpPoint | undefined
    ];
    if (!a || !b || !c || !triangleContains(point, a, b, c)) continue;
    const barycentric = barycentricCoordinates(point, a, b, c);
    if (!barycentric) continue;
    const sourceVertices = triangle.map((vertex) => source[vertex]) as [
      FaceWarpPoint | undefined,
      FaceWarpPoint | undefined,
      FaceWarpPoint | undefined
    ];
    if (sourceVertices.some((vertex) => !vertex)) continue;
    const [sourceA, sourceB, sourceC] = sourceVertices as [
      FaceWarpPoint,
      FaceWarpPoint,
      FaceWarpPoint
    ];
    const sourcePoint: FaceWarpPoint = {
      x: sourceA.x * barycentric[0] + sourceB.x * barycentric[1] + sourceC.x * barycentric[2],
      y: sourceA.y * barycentric[0] + sourceB.y * barycentric[1] + sourceC.y * barycentric[2],
      z: (sourceA.z ?? 0) * barycentric[0]
        + (sourceB.z ?? 0) * barycentric[1]
        + (sourceC.z ?? 0) * barycentric[2]
    };
    const depth = sourcePoint.z ?? 0;
    if (!best || depth < best.depth) {
      best = { sourcePoint, triangle, barycentric, depth };
    }
  }
  return best;
};

/** Face-local hit test against exactly the target triangles shown on canvas. */
export const hitTestDeformedFace = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  point: FaceWarpPoint
): boolean => {
  return findDeformedFaceHit(face, triangleIndices, point) !== null;
};

/** Relax authored brush constraints locally toward their undeformed state. */
export const relaxFaceWarpBrush = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  center: FaceWarpPoint,
  radius: number,
  amount: number
): readonly FaceWarpPoint[] => {
  const source = face.landmarks.mesh;
  const topology = faceWarpTopology(source, triangleIndices);
  const adjacency = topology.adjacency;
  const distances = triangleIndices.length > 0
    ? geodesicDistances(source, adjacency, center, radius)
    : source.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const current = source.map((_, index) => face.displacements?.[index] ?? { x: 0, y: 0 });
  const strength = Math.max(0, Math.min(1, amount));
  return current.map((value, index) => {
    const influence = smoothWeight(distances[index]!, radius) * strength;
    if (influence <= 0) return value;
    const neighbors = topology.laplacianWeights[index]!;
    const average = neighbors.length === 0 ? value : neighbors.reduce((sum, neighbor) => ({
      x: sum.x + current[neighbor.vertex]!.x * neighbor.weight,
      y: sum.y + current[neighbor.vertex]!.y * neighbor.weight
    }), { x: 0, y: 0 });
    const relaxed = { x: average.x * 0.92, y: average.y * 0.92 };
    return {
      x: value.x + (relaxed.x - value.x) * influence,
      y: value.y + (relaxed.y - value.y) * influence
    };
  });
};

/** Restores only authored direct constraints; semantic controls remain intact. */
export const restoreFaceWarpBrush = (
  face: FaceWarpFace,
  triangleIndices: readonly number[],
  center: FaceWarpPoint,
  radius: number,
  amount: number
): readonly FaceWarpPoint[] => {
  const source = face.landmarks.mesh;
  const distances = triangleIndices.length > 0
    ? geodesicDistances(
        source, faceWarpTopology(source, triangleIndices).adjacency, center, radius
      )
    : source.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const strength = Math.max(0, Math.min(1, amount));
  return source.map((_, index) => {
    const current = face.displacements?.[index] ?? { x: 0, y: 0 };
    const influence = smoothWeight(distances[index]!, radius) * strength;
    return {
      x: current.x * (1 - influence),
      y: current.y * (1 - influence)
    };
  });
};
