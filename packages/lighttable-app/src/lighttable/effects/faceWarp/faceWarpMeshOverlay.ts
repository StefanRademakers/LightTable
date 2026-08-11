import type { AffineMatrix } from '@lighttable/vector-core';
import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import { transformPoint } from '../../editor/tools/transform/affine';
import type { FaceWarpFace } from './faceWarpTypes';
import { deformFaceMesh, visibleFaceTriangleIndices } from './faceWarpDeformer';

export const buildFaceWarpMeshOverlay = (
  faces: readonly FaceWarpFace[],
  sourceToDocument: AffineMatrix,
  triangleIndices: readonly number[],
  selectedFaceId: string | null
): VectorEditingOverlay => {
  const cubics: VectorEditingOverlay['cubics'][number][] = [];
  const anchors: VectorEditingOverlay['anchors'][number][] = [];
  faces.forEach((face, faceIndex) => {
    const mesh = deformFaceMesh(face, triangleIndices);
    const visibleTriangles = visibleFaceTriangleIndices(face, triangleIndices);
    const visibleEdges = new Map<string, readonly [number, number]>();
    for (let index = 0; index < visibleTriangles.length; index += 3) {
      const triangle = [
        visibleTriangles[index]!, visibleTriangles[index + 1]!, visibleTriangles[index + 2]!
      ];
      for (let edge = 0; edge < 3; edge += 1) {
        const start = triangle[edge]!;
        const end = triangle[(edge + 1) % 3]!;
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        visibleEdges.set(`${low}:${high}`, [low, high]);
      }
    }
    const visibleVertices = new Set(visibleTriangles);
    [...visibleEdges.values()].forEach(([startIndex, endIndex], segmentIndex) => {
      const sourceStart = mesh[startIndex];
      const sourceEnd = mesh[endIndex];
      if (!sourceStart || !sourceEnd) return;
      const start = transformPoint(sourceToDocument, sourceStart);
      const end = transformPoint(sourceToDocument, sourceEnd);
      cubics.push({
        subpathId: face.id,
        segmentIndex: faceIndex * visibleEdges.size + segmentIndex,
        p0: start, p1: start, p2: end, p3: end
      });
    });
    mesh.forEach((point, index) => {
      if (!visibleVertices.has(index)) return;
      anchors.push({
        subpathId: face.id,
        anchorId: `${face.id}:${index}`,
        point: transformPoint(sourceToDocument, point),
        selected: face.id === selectedFaceId,
        active: false,
        markerKind: 'circle',
        markerSizePx: face.id === selectedFaceId ? 3.25 : 2.25
      });
    });
  });
  return {
    pathId: 'face-warp-mesh',
    resourceKey: `face-warp-mesh:${faces.map((face) => `${face.id}:${JSON.stringify(face.parameters)}:${JSON.stringify(face.displacements ?? [])}`).join(':')}:${selectedFaceId ?? ''}`,
    geometryRevision: faces.reduce(
      (revision, face) => revision + 1 + (face.displacements?.length ?? 0), 0
    ),
    transformRevision: 0,
    cubics,
    anchors,
    handles: []
  };
};
