import type { DepthAnalysisResult } from '../analysis/depth/types';
import type { BasicAdjustments } from '../types';
import { ChromaticAberrationEffect } from './chromaticAberration/ChromaticAberrationEffect';
import { GrainEffect } from './grain/GrainEffect';
import { HalationEffect } from './halation/HalationEffect';
import { LensBlurEffect } from './lensBlur/LensBlurEffect';
import { LensDistortionEffect } from './lensDistortion/LensDistortionEffect';
import type { LightTableEffectRuntimeCallbacks } from './types';

interface TextureEffect {
  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture;
  resize(width: number, height: number): void;
  destroyImageResources(): void;
  destroy(): void;
  estimatedTextureBytes(): number;
}

export interface DocumentEffectSet {
  grain: GrainEffect;
  halation: HalationEffect;
  chromaticAberration: ChromaticAberrationEffect;
  lensDistortion: LensDistortionEffect;
  lensBlur: LensBlurEffect;
}

export interface LinearSpatialEffectOptions {
  visualizeDepth: boolean;
}

/**
 * Owns the document effect instances and their authoritative processing order.
 *
 * WebGpuEngine supplies stage inputs; it does not know the individual effect
 * implementation order or lifecycle anymore.
 */
export class DocumentEffectRuntime {
  constructor(private readonly effects: DocumentEffectSet) {}

  static create(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    adjustments: BasicAdjustments,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ): DocumentEffectRuntime {
    return new DocumentEffectRuntime({
      grain: new GrainEffect(device, sampler, vertexModule, adjustments.effects.grain, callbacks),
      halation: new HalationEffect(device, sampler, vertexModule, adjustments.effects.halation, callbacks),
      chromaticAberration: new ChromaticAberrationEffect(
        device,
        sampler,
        vertexModule,
        adjustments.effects.chromaticAberration,
        callbacks
      ),
      lensDistortion: new LensDistortionEffect(
        device,
        sampler,
        vertexModule,
        adjustments.effects.lensDistortion,
        callbacks
      ),
      lensBlur: new LensBlurEffect(
        device,
        sampler,
        vertexModule,
        adjustments.effects.lensBlur,
        adjustments.effects.lensDistortion,
        callbacks
      )
    });
  }

  setSettings(adjustments: BasicAdjustments): void {
    this.effects.grain.setSettings(adjustments.effects.grain);
    this.effects.halation.setSettings(adjustments.effects.halation);
    this.effects.chromaticAberration.setSettings(adjustments.effects.chromaticAberration);
    this.effects.lensDistortion.setSettings(adjustments.effects.lensDistortion);
    this.effects.lensBlur.setSettings(adjustments.effects.lensBlur);
    this.effects.lensBlur.setDistortionSettings(adjustments.effects.lensDistortion);
  }

  resize(width: number, height: number): void {
    this.forEachEffect((effect) => effect.resize(width, height));
  }

  encodeSourceGeometry(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    const distorted = this.effects.lensDistortion.encode(encoder, input);
    return this.effects.chromaticAberration.encode(encoder, distorted);
  }

  encodeLinearSpatial(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    options: LinearSpatialEffectOptions
  ): GPUTexture {
    const blurred = this.effects.lensBlur.encode(encoder, input);
    return options.visualizeDepth ? blurred : this.effects.halation.encode(encoder, blurred);
  }

  encodeDisplayPost(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    bypass: boolean
  ): GPUTexture {
    return bypass ? input : this.effects.grain.encode(encoder, input);
  }

  setDepthMap(depth: DepthAnalysisResult): void {
    this.effects.lensBlur.setDepthMap(depth);
  }

  setInteractionActive(active: boolean): void {
    this.effects.lensBlur.setInteractionActive(active);
  }

  setDepthVisualization(visible: boolean): void {
    this.effects.lensBlur.setDepthVisualization(visible);
  }

  get hasDepth(): boolean {
    return this.effects.lensBlur.hasDepth;
  }

  estimatedTextureBytes(): number {
    let bytes = 0;
    this.forEachEffect((effect) => { bytes += effect.estimatedTextureBytes(); });
    return bytes;
  }

  destroyImageResources(): void {
    this.forEachEffect((effect) => effect.destroyImageResources());
  }

  destroy(): void {
    this.forEachEffect((effect) => effect.destroy());
  }

  private forEachEffect(operation: (effect: TextureEffect) => void): void {
    operation(this.effects.lensDistortion);
    operation(this.effects.chromaticAberration);
    operation(this.effects.lensBlur);
    operation(this.effects.halation);
    operation(this.effects.grain);
  }
}
