import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { MeshDeformationEffect } from '../deformation/MeshDeformationEffect';
import { buildFaceWarpRenderSurface } from './faceWarpRenderSurface';
import type { FaceWarpNodeSettings } from './faceWarpTypes';

/**
 * Semantic Face Warp executor. Pixels and the editing overlay are both
 * evaluated from `deformFaceMesh`; no generic displacement-field adapter or
 * accumulated synthetic warp strokes exist in this path.
 */
export class FaceWarpEffect implements LightTableGpuEffect<FaceWarpNodeSettings> {
  readonly id = 'face-warp';
  readonly stage = 'source-geometry' as const;
  private readonly mesh: MeshDeformationEffect;
  private settings: FaceWarpNodeSettings;
  private width = 0;
  private height = 0;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: FaceWarpNodeSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.settings = structuredClone(settings);
    this.mesh = new MeshDeformationEffect(device, sampler, vertexModule, {
      opacity: settings.opacity,
      surfaces: []
    }, callbacks);
  }

  setSettings(settings: FaceWarpNodeSettings): void {
    this.settings = structuredClone(settings);
    this.updateSurface();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.mesh.resize(width, height);
    this.updateSurface();
  }
  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    return this.mesh.encode(encoder, input);
  }
  destroyImageResources(): void { this.mesh.destroyImageResources(); }
  estimatedTextureBytes(): number { return this.mesh.estimatedTextureBytes(); }
  deformationTelemetry() { return this.mesh.telemetrySnapshot(); }
  destroy(): void { this.mesh.destroy(); }

  private updateSurface(): void {
    this.mesh.setSettings({
      opacity: this.settings.opacity,
      surfaces: this.width > 0 && this.height > 0 && this.settings.faces.length > 0
        ? [buildFaceWarpRenderSurface(this.settings, this.width, this.height)]
        : []
    });
  }
}
