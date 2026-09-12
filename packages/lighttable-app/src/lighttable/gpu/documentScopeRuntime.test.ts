import { afterEach, expect, it, vi } from 'vitest';
import { DocumentScopeRuntime } from './documentScopeRuntime';
import { WebGpuScopeEngine } from './WebGpuScopeEngine';
import type { LightTableImageMetadata } from '../types';
import type { DocumentRendererScopeCanvases } from '../application/rendering/rendererTypes';

afterEach(() => vi.restoreAllMocks());
const canvases = () => ({ hueDistribution: {} as HTMLCanvasElement, parade: {} as HTMLCanvasElement, vectorscope: {} as HTMLCanvasElement });
const fakeEngine = () => ({ rebindCanvases: vi.fn((_canvases: DocumentRendererScopeCanvases) => true), destroy: vi.fn(), setOptions: vi.fn(),
  setInteractionActive: vi.fn(), setBefore: vi.fn(), setTextures: vi.fn(), resize: vi.fn() });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

it('pending A→B retains the newest complete canvas request before readiness and compiles once', async () => {
  const pending = deferred<WebGpuScopeEngine>(), engine = fakeEngine();
  const create = vi.spyOn(WebGpuScopeEngine, 'create').mockReturnValue(pending.promise);
  const a = canvases(), b = canvases(), ready = vi.fn(() => {
    expect(engine.rebindCanvases).toHaveBeenLastCalledWith(b);
    expect(engine.setTextures).toHaveBeenCalled();
  });
  const runtime = new DocumentScopeRuntime({} as GPUDevice, vi.fn(), ready);
  const first = runtime.initialize({ ...a, colorMixerHueDistribution: {} as HTMLCanvasElement });
  runtime.setTextures({} as GPUTexture, {} as GPUTexture, { width: 100, height: 50 } as LightTableImageMetadata);
  const second = runtime.initialize(b);
  pending.resolve(engine as unknown as WebGpuScopeEngine);
  await Promise.all([first, second]);
  expect(create).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(engine.rebindCanvases.mock.calls[0][0]).not.toHaveProperty('colorMixerHueDistribution');
});

it('ready runtime rebinds all surfaces, retains the engine, and does not notify on unchanged binding', async () => {
  const engine = fakeEngine(), create = vi.spyOn(WebGpuScopeEngine, 'create').mockResolvedValue(engine as unknown as WebGpuScopeEngine);
  const ready = vi.fn(), runtime = new DocumentScopeRuntime({} as GPUDevice, vi.fn(), ready);
  await runtime.initialize(canvases()); ready.mockClear();
  const b = canvases(); await runtime.initialize(b);
  expect(engine.rebindCanvases).toHaveBeenLastCalledWith(b);
  expect(ready).toHaveBeenCalledOnce();
  engine.rebindCanvases.mockReturnValue(false);
  await runtime.initialize(b);
  expect(ready).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
});

it('destroy during compilation retires resources and suppresses ready and failures', async () => {
  const pending = deferred<WebGpuScopeEngine>(), engine = fakeEngine(), error = vi.fn(), ready = vi.fn();
  vi.spyOn(WebGpuScopeEngine, 'create').mockReturnValue(pending.promise);
  const runtime = new DocumentScopeRuntime({} as GPUDevice, error, ready);
  const initializing = runtime.initialize(canvases()); runtime.destroy();
  pending.resolve(engine as unknown as WebGpuScopeEngine); await initializing;
  expect(engine.destroy).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled();
  const failure = deferred<WebGpuScopeEngine>(); vi.mocked(WebGpuScopeEngine.create).mockReturnValue(failure.promise);
  const other = new DocumentScopeRuntime({} as GPUDevice, error, ready);
  const rejected = other.initialize(canvases()); other.destroy(); failure.reject(new Error('retired error')); await rejected;
  expect(error).not.toHaveBeenCalled();
});

it('shared compilation failure reaches only the latest request sink and remains nonfatal to the main image', async () => {
  const pending = deferred<WebGpuScopeEngine>(), oldError = vi.fn(), currentError = vi.fn();
  vi.spyOn(WebGpuScopeEngine, 'create').mockReturnValue(pending.promise);
  const runtime = new DocumentScopeRuntime({} as GPUDevice, oldError, vi.fn());
  const a = runtime.initialize(canvases(), oldError), b = runtime.initialize(canvases(), currentError);
  pending.reject(new Error('GPU scopes compilation failed'));
  await expect(Promise.all([a, b])).resolves.toBeDefined();
  expect(oldError).not.toHaveBeenCalled(); expect(currentError).toHaveBeenCalledWith('GPU scopes compilation failed');
});

it('latest rebind failure destroys the unpublished engine and reports the current request', async () => {
  const pending = deferred<WebGpuScopeEngine>(), engine = fakeEngine(), error = vi.fn(), ready = vi.fn();
  vi.spyOn(WebGpuScopeEngine, 'create').mockReturnValue(pending.promise);
  const runtime = new DocumentScopeRuntime({} as GPUDevice, error, ready);
  const initialized = runtime.initialize(canvases());
  engine.rebindCanvases.mockImplementation(() => { throw new Error('new canvas failed'); });
  pending.resolve(engine as unknown as WebGpuScopeEngine); await initialized;
  expect(engine.destroy).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('new canvas failed');
});

it('captures render-error leases by exact request and rejects a retired presentation even on identical DOM', async () => {
  const engine = fakeEngine(), error = vi.fn();
  const create = vi.spyOn(WebGpuScopeEngine, 'create').mockResolvedValue(engine as unknown as WebGpuScopeEngine);
  const runtime = new DocumentScopeRuntime({} as GPUDevice, error, vi.fn());
  const a = canvases(); let current = true;
  await runtime.initialize(a, error, () => current);
  const capture = create.mock.calls[0][2], first = capture();
  expect(first.isCurrent()).toBe(true);
  current = false; expect(first.isCurrent()).toBe(false);
  await runtime.initialize(a, error, () => true);
  expect(first.isCurrent()).toBe(false); expect(capture().isCurrent()).toBe(true);
  runtime.destroy(); expect(capture().isCurrent()).toBe(false);
});

it('a retired pending presentation cannot reclaim successor canvases before runtime disposal', async () => {
  const pending = deferred<WebGpuScopeEngine>(), engine = fakeEngine(), ready = vi.fn(), error = vi.fn();
  vi.spyOn(WebGpuScopeEngine, 'create').mockReturnValue(pending.promise);
  const runtime = new DocumentScopeRuntime({} as GPUDevice, error, ready);
  let current = true;
  const initialization = runtime.initialize(canvases(), error, () => current);
  current = false; pending.resolve(engine as unknown as WebGpuScopeEngine); await initialization;
  expect(engine.rebindCanvases).not.toHaveBeenCalled(); expect(engine.destroy).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
