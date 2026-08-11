import type { DeformationPoint, DeformationSurface } from '../deformation/deformationSurface';
import { deformFaceMesh } from './faceWarpDeformer';
import { faceWarpCollarPoints, faceWarpTopology } from './faceWarpTopology';
import type { FaceWarpNodeSettings, FaceWarpPoint } from './faceWarpTypes';

const orderedBoundary = (
  mesh: readonly FaceWarpPoint[],
  triangleIndices: readonly number[]
): readonly number[] => {
  const topology = faceWarpTopology(mesh, triangleIndices);
  if (topology.featureLoops.faceOval.length >= 3) return topology.featureLoops.faceOval;
  const boundary = [...topology.boundaryVertices];
  const center = boundary.reduce((sum, vertex) => ({
    x: sum.x + mesh[vertex]!.x / Math.max(1, boundary.length),
    y: sum.y + mesh[vertex]!.y / Math.max(1, boundary.length)
  }), { x: 0, y: 0 });
  return boundary.sort((left, right) =>
    Math.atan2(mesh[left]!.y - center.y, mesh[left]!.x - center.x)
    - Math.atan2(mesh[right]!.y - center.y, mesh[right]!.x - center.x));
};

/**
 * Builds a face-local indexed surface. The original texture remains untouched
 * outside the pinned collar; no face vertex is ever triangulated against a
 * remote layer/canvas point.
 */
export const buildFaceWarpRenderSurface = (
  settings: FaceWarpNodeSettings,
  width: number,
  height: number
): DeformationSurface => {
  const source: DeformationPoint[] = [];
  const target: DeformationPoint[] = [];
  const indices: number[] = [];

  settings.faces.forEach((face) => {
    const faceOffset = source.length;
    const depths = face.landmarks.mesh.map(({ z }) => z ?? 0);
    const minimumDepth = Math.min(...depths);
    const depthRange = Math.max(1e-6, Math.max(...depths) - minimumDepth);
    const normalizedDepth = (z: number | undefined) =>
      Math.max(0, Math.min(0.98, ((z ?? minimumDepth) - minimumDepth) / depthRange));
    const sourceMesh = face.landmarks.mesh.map(({ x, y, z }) => ({
      x, y, z: normalizedDepth(z)
    }));
    const desiredMesh = deformFaceMesh(face, settings.topology.triangleIndices)
      .map(({ x, y, z }) => ({ x, y, z: normalizedDepth(z) }));
    const boundary = orderedBoundary(face.landmarks.mesh, settings.topology.triangleIndices);
    const collar = faceWarpCollarPoints(sourceMesh, boundary);

    source.push(...sourceMesh);
    target.push(...desiredMesh);
    indices.push(...settings.topology.triangleIndices.map((vertex) => faceOffset + vertex));

    const collarOffset = source.length;
    boundary.forEach((_, boundaryIndex) => {
      const outer = collar[boundaryIndex]!;
      source.push({ ...outer, z: 1 });
      target.push({ ...outer, z: 1 });
    });
    boundary.forEach((vertex, boundaryIndex) => {
      const nextBoundaryIndex = (boundaryIndex + 1) % boundary.length;
      const nextVertex = boundary[nextBoundaryIndex]!;
      const inner = faceOffset + vertex;
      const nextInner = faceOffset + nextVertex;
      const outer = collarOffset + boundaryIndex;
      const nextOuter = collarOffset + nextBoundaryIndex;
      indices.push(inner, nextInner, outer, nextInner, nextOuter, outer);
    });

  });

  return {
    source,
    target,
    indices,
    geometryRevision: settings.sourceRevision + settings.faces.length + width * 31 + height * 17
  };
};
