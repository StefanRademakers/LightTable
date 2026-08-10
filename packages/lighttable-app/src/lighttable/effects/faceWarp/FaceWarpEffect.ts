import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { WarpEffect } from '../warp/WarpEffect';
import type { WarpNodeSettings } from '../warp/warpTypes';
import { compileFaceWarpStrokes } from './faceWarpCompiler';
import type { FaceWarpNodeSettings } from './faceWarpTypes';

const asWarpSettings = (settings: FaceWarpNodeSettings): WarpNodeSettings => ({
  version: 1,
  opacity: settings.opacity,
  borderMode: 'clamp',
  topologyMode: 'protected',
  edgePinning: 0,
  maskLinkMode: 'linked',
  strokes: compileFaceWarpStrokes(settings.faces)
});

/**
 * Semantic Face Warp executor. The authored node remains `lt.face-warp`; only
 * its transient deformation constraints are delegated to the shared GPU Warp
 * field implementation.
 */
export class FaceWarpEffect implements LightTableGpuEffect<FaceWarpNodeSettings> {
  readonly id = 'face-warp';
  readonly stage = 'source-geometry' as const;
  private readonly warp: WarpEffect;

  constructor(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: FaceWarpNodeSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.warp = new WarpEffect(
      device,
      sampler,
      vertexModule,
      asWarpSettings(settings),
      callbacks
    );
  }

  setSettings(settings: FaceWarpNodeSettings): void {
    this.warp.setSettings(asWarpSettings(settings));
  }

  resize(width: number, height: number): void {
    this.warp.resize(width, height);
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    return this.warp.encode(encoder, input);
  }

  destroyImageResources(): void {
    this.warp.destroyImageResources();
  }

  estimatedTextureBytes(): number {
    return this.warp.estimatedTextureBytes();
  }

  destroy(): void {
    this.warp.destroy();
  }
}

