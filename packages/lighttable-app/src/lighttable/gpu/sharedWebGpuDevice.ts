import {
  classifyWebGpuSupport,
  snapshotWebGpuLimits,
  type WebGpuLimitSnapshot,
  type WebGpuSupportTier
} from './webGpuSupportTier';
import { lockVectorRendererConfiguration } from './vectorRendererBackendDiagnostics';

export const TEXTURE_FORMATS_TIER1: GPUFeatureName = 'texture-formats-tier1';

export interface WebGpuAdapterProvider {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

interface DirectWebGpuDeviceProvider {
  request(): Promise<{
    readonly device: GPUDevice;
    readonly diagnostics: Omit<SharedWebGpuDiagnosticSnapshot, 'features' | 'limits' | 'support'>;
  }>;
  release(device: GPUDevice): void | Promise<void>;
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
  private pendingDirectRelease: Promise<void> | null = null;
  private readonly lostListeners = new Set<SharedWebGpuDeviceLostListener>();

  constructor(
    private readonly adapterProvider: WebGpuAdapterProvider,
    private readonly directProvider: DirectWebGpuDeviceProvider | null = null
  ) {}

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
      if (this.directProvider) {
        if (this.pendingDirectRelease) await this.pendingDirectRelease;
        const result = await this.directProvider.request();
        const limits = snapshotWebGpuLimits(result.device.limits);
        const support = classifyWebGpuSupport(limits);
        if (support.id === 'below-floor') {
          await this.directProvider.release(result.device);
          throw new Error(`${support.label}. ${support.action}`);
        }
        this.adapterSnapshot = {
          ...result.diagnostics,
          features: [...result.device.features].map(String).sort(),
          limits,
          support
        };
        this.bindDeviceLoss(result.device);
        return result.device;
      }
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
      this.bindDeviceLoss(device);
      return device;
    } catch (reason) {
      this.device = null;
      throw reason;
    } finally {
      this.pending = null;
    }
  }

  private bindDeviceLoss(device: GPUDevice) {
    this.device = device;
    void device.lost.then((info) => {
      if (this.device === device) {
        this.device = null;
        this.pending = null;
        if (this.directProvider) {
          const release = Promise.resolve().then(() => this.directProvider!.release(device));
          const pending = release.finally(() => {
            if (this.pendingDirectRelease === pending) this.pendingDirectRelease = null;
          });
          this.pendingDirectRelease = pending;
          // Keep a rejected release observable to the next acquire without an
          // unhandled rejection when no document immediately retries.
          void pending.catch(() => undefined);
        }
      }
      for (const listener of this.lostListeners) listener(info);
    });
  }
}

let browserManager: SharedWebGpuDeviceManager | null = null;

const getBrowserManager = () => {
  if (!navigator.gpu) {
    throw new Error(
      'WebGPU is not available in this browser. Use a current Chromium-based desktop browser.'
    );
  }
  if (!browserManager) {
    lockVectorRendererConfiguration();
    const directProvider: DirectWebGpuDeviceProvider = {
      request: async () => {
        const runtime = await import('@lighttable/vector-vello')
          .then((module) => module.requestVelloWebGpuRuntime());
        return {
          device: runtime.device,
          diagnostics: {
            vendor: String(runtime.diagnostics.vendor),
            architecture: runtime.diagnostics.architecture,
            device: String(runtime.diagnostics.device),
            description: `${runtime.diagnostics.description} (${runtime.diagnostics.backend})`
          }
        };
      },
      release: (device) => {
        return import('@lighttable/vector-vello')
          .then((module) => module.releaseVelloWebGpuRuntime(device));
      }
    };
    browserManager = new SharedWebGpuDeviceManager(navigator.gpu, directProvider);
  }
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
