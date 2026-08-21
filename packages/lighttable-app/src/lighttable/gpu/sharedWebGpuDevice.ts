import {
  classifyWebGpuSupport,
  snapshotWebGpuLimits,
  type WebGpuLimitSnapshot,
  type WebGpuSupportTier
} from './webGpuSupportTier';

export const TEXTURE_FORMATS_TIER1: GPUFeatureName = 'texture-formats-tier1';

export interface WebGpuAdapterProvider {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

export type SharedWebGpuDeviceLostListener = (info: GPUDeviceLostInfo) => void;

export interface SharedWebGpuDiagnosticSnapshot {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly limits: WebGpuLimitSnapshot;
  readonly support: WebGpuSupportTier;
}

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
  private adapterSnapshot: SharedWebGpuDiagnosticSnapshot | null = null;
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

  diagnostics(): SharedWebGpuDiagnosticSnapshot | null {
    return this.adapterSnapshot;
  }

  private async acquire(): Promise<GPUDevice> {
    try {
      const adapter = await this.adapterProvider.requestAdapter({
        powerPreference: 'high-performance'
      });
      if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
      const info = adapter.info ?? {} as GPUAdapterInfo;
      const limits = snapshotWebGpuLimits(adapter.limits);
      const support = classifyWebGpuSupport(limits);
      if (support.id === 'below-floor') throw new Error(`${support.label}. ${support.action}`);
      this.adapterSnapshot = {
        vendor: info.vendor ?? '',
        architecture: info.architecture ?? '',
        device: info.device ?? '',
        description: info.description ?? '',
        features: [...adapter.features].map(String).sort(),
        limits,
        support
      };
      const requiredFeatures = adapter.features.has(TEXTURE_FORMATS_TIER1)
        ? [TEXTURE_FORMATS_TIER1]
        : [];
      // WebGPU device defaults can be lower than the limits advertised by the
      // selected adapter (notably 8192 instead of 16384 texture dimensions and
      // 256 MiB instead of 1 GiB buffers). Request the qualified adapter limits
      // explicitly so large documents do not create invalid textures and only
      // surface the failure later as an unrelated invalid bind group.
      const device = await adapter.requestDevice({
        requiredFeatures,
        requiredLimits: {
          maxTextureDimension2D: limits.maxTextureDimension2D,
          maxBufferSize: limits.maxBufferSize
        }
      });
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

/** Read-only; never initializes WebGPU or requests another adapter. */
export const sharedWebGpuDiagnostics = (): SharedWebGpuDiagnosticSnapshot | null =>
  browserManager?.diagnostics() ?? null;
