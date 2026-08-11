import { validateDeformationSurface, type DeformationSurface } from './deformationSurface';

export interface PackedDeformationSurfaces {
  readonly sourcePositions: Float32Array<ArrayBuffer>;
  readonly targetPositions: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
  readonly isIdentity: boolean;
}

/**
 * Packs any indexed 2D deformation topology for the GPU renderer. Face Warp
 * and future rectangular/custom warp authoring intentionally meet only here;
 * no semantic landmark or patch-network concept enters the render contract.
 */
export const packDeformationSurfaces = (
  surfaces: readonly DeformationSurface[]
): PackedDeformationSurfaces => {
  const sourcePositions: number[] = [];
  const targetPositions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  let isIdentity = true;

  surfaces.forEach((surface) => {
    validateDeformationSurface(surface);
    surface.source.forEach((source, index) => {
      const target = surface.target[index]!;
      sourcePositions.push(source.x, source.y);
      targetPositions.push(target.x, target.y, target.z ?? 0.5);
      if (source.x !== target.x || source.y !== target.y) isIdentity = false;
    });
    indices.push(...surface.indices.map((index) => index + vertexOffset));
    vertexOffset += surface.source.length;
  });

  return {
    sourcePositions: new Float32Array(sourcePositions),
    targetPositions: new Float32Array(targetPositions),
    indices: new Uint32Array(indices),
    isIdentity
  };
};
