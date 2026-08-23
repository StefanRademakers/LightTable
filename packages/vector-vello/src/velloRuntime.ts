interface GeneratedVelloModule {
  default: (input?: { module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module }) => Promise<unknown>;
  VelloInteropDevice: {
    create(): Promise<GeneratedVelloDevice>;
  };
}

export interface GeneratedVelloDevice {
  device_handle(): GPUDevice;
  diagnostics_json(): string;
  render_paint_scene_texture(
    texture: GPUTexture,
    width: number,
    height: number,
    sceneKey: string,
    sceneJson: string
  ): boolean;
  render_incremental_paint_scene_texture(
    texture: GPUTexture,
    width: number,
    height: number,
    sourceId: string,
    updateJson: string
  ): boolean;
  incremental_profile_json(): string;
  has_paint_scene_source(sourceId: string): boolean;
  release_paint_scene_source(sourceId: string): void;
  scene_cache_entries(): number;
  dispose(): void;
  free(): void;
}

export interface VelloWebGpuDiagnostics {
  readonly vendor: number;
  readonly architecture: string;
  readonly device: number;
  readonly description: string;
  readonly backend: string;
  readonly maxTextureDimension2D: number;
  readonly maxBufferSize: number;
}

export interface VelloRuntime {
  readonly bridge: GeneratedVelloDevice;
  readonly device: GPUDevice;
  readonly diagnostics: VelloWebGpuDiagnostics;
  released: boolean;
}

interface VelloRuntimeStore {
  current: VelloRuntime | null;
  pending: Promise<VelloRuntime> | null;
  readonly byDevice: WeakMap<GPUDevice, VelloRuntime>;
}

const runtimeStoreKey = Symbol.for('@lighttable/vector-vello/runtime-store-v1');
const runtimeGlobal = globalThis as typeof globalThis & {
  [runtimeStoreKey]?: VelloRuntimeStore;
};
const runtimeStore = runtimeGlobal[runtimeStoreKey] ??= {
  current: null,
  pending: null,
  byDevice: new WeakMap<GPUDevice, VelloRuntime>()
};

const load = async (): Promise<VelloRuntime> => {
  const generated = await import('./generated/vector_vello_wasm.js') as GeneratedVelloModule;
  await generated.default();
  const bridge = await generated.VelloInteropDevice.create();
  const device = bridge.device_handle();
  const value = {
    bridge,
    device,
    diagnostics: JSON.parse(bridge.diagnostics_json()) as VelloWebGpuDiagnostics,
    released: false
  };
  runtimeStore.byDevice.set(device, value);
  return value;
};

export const requestVelloWebGpuRuntime = async (): Promise<VelloRuntime> => {
  if (runtimeStore.current) {
    return runtimeStore.current;
  }
  runtimeStore.pending ??= load().then((value) => {
    runtimeStore.current = value;
    return value;
  }).finally(() => {
    runtimeStore.pending = null;
  });
  return runtimeStore.pending;
};

export const activeVelloWebGpuRuntime = (device: GPUDevice): VelloRuntime => {
  const owned = runtimeStore.byDevice.get(device);
  if (!owned || owned.released) {
    throw new Error(
      'The selected WebGPU device is not owned by the active Vello runtime '
      + `(current=${Boolean(runtimeStore.current)}, `
      + `sameDevice=${runtimeStore.current?.device === device}, `
      + `currentReleased=${runtimeStore.current?.released ?? 'none'}, mapped=${Boolean(owned)}, `
      + `mappedReleased=${owned?.released ?? 'none'}).`
    );
  }
  return owned;
};

export const releaseVelloWebGpuRuntime = (device: GPUDevice) => {
  const owned = runtimeStore.byDevice.get(device);
  if (!owned || owned.released) return;
  owned.released = true;
  owned.bridge.dispose();
  owned.bridge.free();
  runtimeStore.byDevice.delete(device);
  if (runtimeStore.current === owned) runtimeStore.current = null;
};
