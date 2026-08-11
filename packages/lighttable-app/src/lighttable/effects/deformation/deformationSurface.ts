export interface DeformationPoint {
  readonly x: number;
  readonly y: number;
  /** Optional normalized target depth; 0 is nearest and 1 is farthest. */
  readonly z?: number;
}

/**
 * Renderer-facing geometry shared by semantic Face Warp and future custom
 * warp authoring. Authoring tools own their topology and constraints; the GPU
 * renderer only consumes this immutable source/target surface.
 */
export interface DeformationSurface {
  readonly source: readonly DeformationPoint[];
  readonly target: readonly DeformationPoint[];
  readonly indices: readonly number[];
  readonly geometryRevision: number;
}

export const validateDeformationSurface = (surface: DeformationSurface): void => {
  if (surface.source.length !== surface.target.length) {
    throw new Error('A deformation surface requires matching source and target vertices.');
  }
  if (surface.indices.length % 3 !== 0) {
    throw new Error('A deformation surface index list must contain triangles.');
  }
  if ([...surface.source, ...surface.target].some((point) =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || (point.z !== undefined && (!Number.isFinite(point.z) || point.z < 0 || point.z > 1)))) {
    throw new Error('Deformation surface vertices must contain finite coordinates and normalized depth.');
  }
  for (const index of surface.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= surface.source.length) {
      throw new Error(`Deformation surface index ${index} is outside the vertex range.`);
    }
  }
};

export const trianglesFromUndirectedEdges = (
  vertexCount: number,
  edges: readonly (readonly [number, number])[]
): number[] => {
  const adjacency = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) continue;
    adjacency[a]!.add(b);
    adjacency[b]!.add(a);
  }
  const triangles: number[] = [];
  for (let a = 0; a < vertexCount; a += 1) {
    for (const b of adjacency[a]!) {
      if (b <= a) continue;
      for (const c of adjacency[a]!) {
        if (c <= b || !adjacency[b]!.has(c)) continue;
        triangles.push(a, b, c);
      }
    }
  }
  return triangles;
};
