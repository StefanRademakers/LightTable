export interface SubmittedResourceRetainerOptions {
  onSubmittedWorkDone: () => Promise<unknown>;
}

export const releaseAfterSubmittedWork = (
  onSubmittedWorkDone: () => Promise<unknown>,
  release: () => void
) => {
  void onSubmittedWorkDone().then(release, release);
};

/**
 * Retains transient GPU resources until the submit that references them has
 * completed. Encoding code can register resources without owning queue timing.
 */
export class SubmittedResourceRetainer {
  private pendingBuffers: GPUBuffer[] = [];
  private pendingTextures: GPUTexture[] = [];

  constructor(private readonly options: SubmittedResourceRetainerOptions) {}

  retainBuffer(buffer: GPUBuffer) {
    this.pendingBuffers.push(buffer);
    return buffer;
  }

  retainTexture(texture: GPUTexture) {
    this.pendingTextures.push(texture);
    return texture;
  }

  releaseAfterSubmittedWork() {
    const buffers = this.pendingBuffers.splice(0);
    const textures = this.pendingTextures.splice(0);
    if (!buffers.length && !textures.length) return;
    releaseAfterSubmittedWork(this.options.onSubmittedWorkDone, () => {
      // Device loss still releases JavaScript ownership. WebGPU resources are
      // already invalid then, so the same explicit cleanup remains safe.
      buffers.forEach((buffer) => buffer.destroy());
      textures.forEach((texture) => texture.destroy());
    });
  }

  destroyPending() {
    this.pendingBuffers.splice(0).forEach((buffer) => buffer.destroy());
    this.pendingTextures.splice(0).forEach((texture) => texture.destroy());
  }
}
