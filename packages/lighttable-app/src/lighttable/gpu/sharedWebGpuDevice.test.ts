import { describe, expect, it, vi } from 'vitest';
import {
  SharedWebGpuDeviceManager,
  TEXTURE_FORMATS_TIER1,
  type WebGpuAdapterProvider
} from './sharedWebGpuDevice';

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

const createDevice = () => {
  const lost = deferred<GPUDeviceLostInfo>();
  return {
    device: {
      lost: lost.promise,
      features: new Set<GPUFeatureName>(),
      limits: {
        maxTextureDimension2D: 16384, maxBufferSize: 1024 * 1024 * 1024,
        maxStorageBufferBindingSize: 128 * 1024 * 1024,
        maxComputeWorkgroupStorageSize: 32 * 1024
      }
    } as unknown as GPUDevice,
    lost
  };
};

const createProvider = (devices: GPUDevice[], supportsTier1 = true) => {
  const requestDevice = vi.fn(async () => {
    const device = devices.shift();
    if (!device) throw new Error('No test device remains.');
    return device;
  });
  const adapter = {
    info: { vendor: 'test-vendor', architecture: 'test-arch', device: 'test-device', description: 'Test GPU' },
    features: new Set<GPUFeatureName>(
      supportsTier1 ? [TEXTURE_FORMATS_TIER1] : []
    ),
    limits: {
      maxTextureDimension2D: 16384, maxBufferSize: 1024 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxComputeWorkgroupStorageSize: 32 * 1024
    },
    requestDevice
  } as unknown as GPUAdapter;
  const provider: WebGpuAdapterProvider = {
    requestAdapter: vi.fn(async () => adapter)
  };
  return { provider, requestDevice };
};

describe('SharedWebGpuDeviceManager', () => {
  it('coalesces concurrent requests and reuses the acquired device', async () => {
    const first = createDevice();
    const { provider, requestDevice } = createProvider([first.device]);
    const manager = new SharedWebGpuDeviceManager(provider);

    const [left, right] = await Promise.all([manager.request(), manager.request()]);
    const reused = await manager.request();

    expect(left).toBe(first.device);
    expect(right).toBe(first.device);
    expect(reused).toBe(first.device);
    expect(provider.requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(manager.diagnostics()).toEqual({
      vendor: 'test-vendor', architecture: 'test-arch', device: 'test-device',
      description: 'Test GPU', features: [TEXTURE_FORMATS_TIER1],
      limits: {
        maxTextureDimension2D: 16384, maxBufferSize: 1073741824,
        maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupStorageSize: 32768
      },
      support: {
        id: 'candidate-recommended', label: 'Recommended WebGPU capability',
        action: 'Large layered documents still require a measured physical-device qualification.'
      }
    });
  });

  it('requests tier-one texture formats only when supported', async () => {
    const supported = createDevice();
    const supportedProvider = createProvider([supported.device], true);
    await new SharedWebGpuDeviceManager(supportedProvider.provider).request();
    expect(supportedProvider.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: [TEXTURE_FORMATS_TIER1],
      requiredLimits: { maxTextureDimension2D: 16384, maxBufferSize: 1073741824 }
    });

    const unsupported = createDevice();
    const unsupportedProvider = createProvider([unsupported.device], false);
    await new SharedWebGpuDeviceManager(unsupportedProvider.provider).request();
    expect(unsupportedProvider.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: [],
      requiredLimits: { maxTextureDimension2D: 16384, maxBufferSize: 1073741824 }
    });
  });

  it('notifies subscribers and reacquires after device loss', async () => {
    const first = createDevice();
    const second = createDevice();
    const { provider } = createProvider([first.device, second.device]);
    const manager = new SharedWebGpuDeviceManager(provider);
    const listener = vi.fn();
    const unsubscribe = manager.subscribeLost(listener);

    expect(await manager.request()).toBe(first.device);
    const info = { message: 'reset', reason: 'unknown' } as GPUDeviceLostInfo;
    first.lost.resolve(info);
    await first.device.lost;
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(info);
    expect(await manager.request()).toBe(second.device);
    expect(provider.requestAdapter).toHaveBeenCalledTimes(2);

    unsubscribe();
    second.lost.resolve(info);
    await second.device.lost;
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('allows a clean retry after adapter acquisition fails', async () => {
    const device = createDevice();
    const provider: WebGpuAdapterProvider = {
      requestAdapter: vi.fn()
        .mockRejectedValueOnce(new Error('adapter failed'))
        .mockResolvedValueOnce({
          features: new Set(),
          limits: {
            maxTextureDimension2D: 8192, maxBufferSize: 268435456,
            maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupStorageSize: 32768
          },
          requestDevice: vi.fn(async () => device.device)
        } as unknown as GPUAdapter)
    };
    const manager = new SharedWebGpuDeviceManager(provider);

    await expect(manager.request()).rejects.toThrow('adapter failed');
    await expect(manager.request()).resolves.toBe(device.device);
    expect(provider.requestAdapter).toHaveBeenCalledTimes(2);
  });

  it('uses and releases an explicitly shared direct device without requesting another adapter', async () => {
    const direct = createDevice();
    const release = vi.fn();
    const provider: WebGpuAdapterProvider = { requestAdapter: vi.fn() };
    const manager = new SharedWebGpuDeviceManager(provider, {
      request: vi.fn(async () => ({
        device: direct.device,
        diagnostics: {
          vendor: 'vello-vendor', architecture: 'discrete',
          device: 'vello-device', description: 'Vello shared device'
        }
      })),
      release
    });

    expect(await manager.request()).toBe(direct.device);
    expect(provider.requestAdapter).not.toHaveBeenCalled();
    expect(manager.diagnostics()).toMatchObject({
      vendor: 'vello-vendor', description: 'Vello shared device'
    });

    const info = { message: 'lost', reason: 'unknown' } as GPUDeviceLostInfo;
    direct.lost.resolve(info);
    await direct.device.lost;
    await Promise.resolve();
    expect(release).toHaveBeenCalledWith(direct.device);
  });

  it('waits for direct-runtime release before reacquiring after device loss', async () => {
    const first = createDevice();
    const second = createDevice();
    const releaseGate = deferred<void>();
    const devices = [first.device, second.device];
    const request = vi.fn(async () => ({
      device: devices.shift()!,
      diagnostics: {
        vendor: 'vello-vendor', architecture: 'discrete',
        device: 'vello-device', description: 'Vello shared device'
      }
    }));
    const manager = new SharedWebGpuDeviceManager(
      { requestAdapter: vi.fn() },
      { request, release: vi.fn(async () => releaseGate.promise) }
    );

    expect(await manager.request()).toBe(first.device);
    first.lost.resolve({ message: 'lost', reason: 'unknown' } as GPUDeviceLostInfo);
    await first.device.lost;
    await Promise.resolve();
    const reacquired = manager.request();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    releaseGate.resolve();
    await expect(reacquired).resolves.toBe(second.device);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
