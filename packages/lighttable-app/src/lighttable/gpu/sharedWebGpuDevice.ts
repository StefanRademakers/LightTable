export const TEXTURE_FORMATS_TIER1: GPUFeatureName = 'texture-formats-tier1';

export interface WebGpuAdapterProvider {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

export type SharedWebGpuDeviceLostListener = (info: GPUDeviceLostInfo) => void;

/**
 * Owns the process-wide WebGPU device shared by document renderers.
 *
 * A GPUDevice is canvas-independent and expensive to create. The manager
 * coalesces concurrent document startups, negotiates optional format support
 * once and invalidates the cached device after loss so a later document can
 * recover with a fresh device.
 */
export class SharedWebGpuDeviceManager {
  private device: GPUDevice | null = null;
  private pending: Promise<GPUDevice> | null = null;
  private readonly lostListeners = new Set<SharedWebGpuDeviceLostListener>();

  constructor(private readonly adapterProvider: WebGpuAdapterProvider) {}

  request(): Promise<GPUDevice> {
    if (this.device) return Promise.resolve(this.device);
    if (this.pending) return this.pending;
    this.pending = this.acquire();
    return this.pending;
  }

  subscribeLost(listener: SharedWebGpuDeviceLostListener): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  private async acquire(): Promise<GPUDevice> {
    try {
      const adapter = await this.adapterProvider.requestAdapter({
        powerPreference: 'high-performance'
      });
      if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
      const requiredFeatures = adapter.features.has(TEXTURE_FORMATS_TIER1)
        ? [TEXTURE_FORMATS_TIER1]
        : [];
      const device = await adapter.requestDevice({ requiredFeatures });
      this.device = device;
      void device.lost.then((info) => {
        if (this.device === device) {
          this.device = null;
          this.pending = null;
        }
        for (const listener of this.lostListeners) listener(info);
      });
      return device;
    } catch (reason) {
      this.device = null;
      throw reason;
    } finally {
      this.pending = null;
    }
  }
}

let browserManager: SharedWebGpuDeviceManager | null = null;

const getBrowserManager = () => {
  if (!navigator.gpu) {
    throw new Error(
      'WebGPU is not available in this browser. Use a current Chromium-based desktop browser.'
    );
  }
  browserManager ??= new SharedWebGpuDeviceManager(navigator.gpu);
  return browserManager;
};

export const requestSharedWebGpuDevice = (): Promise<GPUDevice> =>
  getBrowserManager().request();

export const subscribeSharedWebGpuDeviceLost = (
  listener: SharedWebGpuDeviceLostListener
): (() => void) => getBrowserManager().subscribeLost(listener);
