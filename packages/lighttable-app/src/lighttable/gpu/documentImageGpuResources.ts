type DestroyableGpuResource = Pick<GPUTexture, 'destroy'> | Pick<GPUBuffer, 'destroy'>;

/**
 * Mutable GPU resources whose lifetime is exactly one loaded document image.
 *
 * Pipelines, samplers and uniform buffers are engine/device resources and do
 * not belong here. Keeping image-bound resources together gives reload,
 * suspension and disposal one deterministic teardown boundary.
 */
export class DocumentImageGpuResources {
  sourceTexture: GPUTexture | null = null;
  correctedTexture: GPUTexture | null = null;
  downsampleTexture: GPUTexture | null = null;
  blurTexture: GPUTexture | null = null;
  creativeTexture: GPUTexture | null = null;
  displayTexture: GPUTexture | null = null;
  finalTexture: GPUTexture | null = null;

  downsampleBindGroup: GPUBindGroup | null = null;
  blurHorizontalBindGroup: GPUBindGroup | null = null;
  blurVerticalBindGroup: GPUBindGroup | null = null;
  creativeBindGroup: GPUBindGroup | null = null;
  blitOriginalBindGroup: GPUBindGroup | null = null;
  blitCorrectedBindGroup: GPUBindGroup | null = null;
  differenceBindGroup: GPUBindGroup | null = null;
  blitOriginalNearestBindGroup: GPUBindGroup | null = null;
  blitCorrectedNearestBindGroup: GPUBindGroup | null = null;
  differenceNearestBindGroup: GPUBindGroup | null = null;

  reset(): void {
    const resources: Array<DestroyableGpuResource | null> = [
      this.sourceTexture,
      this.correctedTexture,
      this.downsampleTexture,
      this.blurTexture,
      this.creativeTexture,
      this.displayTexture,
      this.finalTexture
    ];
    const destroyed = new Set<DestroyableGpuResource>();
    for (const resource of resources) {
      if (!resource || destroyed.has(resource)) continue;
      destroyed.add(resource);
      resource.destroy();
    }

    this.sourceTexture = null;
    this.correctedTexture = null;
    this.downsampleTexture = null;
    this.blurTexture = null;
    this.creativeTexture = null;
    this.displayTexture = null;
    this.finalTexture = null;
    this.clearBindGroups();
  }

  clearBindGroups(): void {
    this.downsampleBindGroup = null;
    this.blurHorizontalBindGroup = null;
    this.blurVerticalBindGroup = null;
    this.creativeBindGroup = null;
    this.blitOriginalBindGroup = null;
    this.blitCorrectedBindGroup = null;
    this.differenceBindGroup = null;
    this.blitOriginalNearestBindGroup = null;
    this.blitCorrectedNearestBindGroup = null;
    this.differenceNearestBindGroup = null;
  }
}
