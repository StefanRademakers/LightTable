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
}

let runtime: VelloRuntime | null = null;
let pending: Promise<VelloRuntime> | null = null;

const load = async (): Promise<VelloRuntime> => {
  const generated = await import('./generated/vector_vello_wasm.js') as GeneratedVelloModule;
  await generated.default();
  const bridge = await generated.VelloInteropDevice.create();
  const device = bridge.device_handle();
  return {
    bridge,
    device,
    diagnostics: JSON.parse(bridge.diagnostics_json()) as VelloWebGpuDiagnostics
  };
};

export const requestVelloWebGpuRuntime = async (): Promise<VelloRuntime> => {
  if (runtime) return runtime;
  pending ??= load().then((value) => {
    runtime = value;
    return value;
  }).finally(() => {
    pending = null;
  });
  return pending;
};

export const activeVelloWebGpuRuntime = (device: GPUDevice): VelloRuntime => {
  if (!runtime || runtime.device !== device) {
    throw new Error('The selected WebGPU device is not owned by the active Vello runtime.');
  }
  return runtime;
};

export const releaseVelloWebGpuRuntime = (device: GPUDevice) => {
  if (!runtime || runtime.device !== device) return;
  runtime.bridge.dispose();
  runtime.bridge.free();
  runtime = null;
};
