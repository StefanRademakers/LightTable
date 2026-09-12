import { beforeEach, expect, it, vi } from 'vitest';
import { ScopeCanvasBinding } from './ScopeCanvasBinding';
import type { ScopeTheme } from '@lighttable/ui/scopeRendering';

const theme = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock('@lighttable/ui/scopeRendering', () => ({ observeScopeTheme: theme.observe }));
beforeEach(() => { theme.observe.mockReset().mockImplementation((_canvas, publish) => {
  publish({ light: false, background: [0, 0, 0] });
  return vi.fn();
}); });
const surface = () => {
  const context = { configure: vi.fn(), unconfigure: vi.fn() };
  const canvas = { getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
  return { context, canvas };
};
const canvases = () => ({ hueDistribution: surface().canvas, parade: surface().canvas, vectorscope: surface().canvas });
const binding = (onTheme = vi.fn()) => new ScopeCanvasBinding({} as GPUDevice, 'bgra8unorm', onTheme);
const context = (canvas: HTMLCanvasElement) => canvas.getContext('webgpu')!;

it('replaces the complete canvas set and theme owner, with no work on unchanged sets', () => {
  const a = canvases(), b = canvases(), publish = vi.fn(), owner = binding(publish);
  expect(owner.rebind(a)).toBe(true);
  const stopA = theme.observe.mock.results[0].value;
  expect(owner.rebind({ ...a })).toBe(false);
  expect(context(a.parade).configure).toHaveBeenCalledTimes(1);
  expect(owner.rebind(b)).toBe(true);
  expect(owner.canvases).toEqual(b);
  expect(owner.context('parade')).toBe(context(b.parade));
  expect(context(a.parade).unconfigure).toHaveBeenCalledOnce();
  expect(stopA).toHaveBeenCalledOnce();
  const calls = publish.mock.calls.length;
  theme.observe.mock.calls[0][1]({ light: true } as ScopeTheme);
  expect(publish).toHaveBeenCalledTimes(calls);
  theme.observe.mock.calls[1][1]({ light: true } as ScopeTheme);
  expect(publish).toHaveBeenCalledTimes(calls + 1);
});

it('attaches/removes optional Color Mixer without touching unchanged contexts or theme', () => {
  const a = canvases(), mixer = surface(), owner = binding();
  owner.rebind(a);
  owner.rebind({ ...a, colorMixerHueDistribution: mixer.canvas });
  expect(context(a.hueDistribution).configure).toHaveBeenCalledOnce();
  expect(theme.observe).toHaveBeenCalledOnce();
  owner.rebind(a);
  expect(owner.context('colorMixerHueDistribution')).toBeNull();
  expect(mixer.context.unconfigure).toHaveBeenCalledOnce();
});

it('validates every required and optional context before publishing a replacement', () => {
  const a = canvases(), b = canvases(), owner = binding();
  owner.rebind(a);
  vi.mocked(b.vectorscope.getContext).mockReturnValue(null);
  expect(() => owner.rebind(b)).toThrow('vectorscope');
  expect(owner.canvases).toEqual(a);
  expect(context(b.parade).configure).not.toHaveBeenCalled();
  expect(context(a.parade).unconfigure).not.toHaveBeenCalled();
  const broken = surface(); vi.mocked(broken.canvas.getContext).mockReturnValue(null);
  expect(() => owner.rebind({ ...a, colorMixerHueDistribution: broken.canvas })).toThrow('colorMixer');
});

it('configuration failure releases staged contexts without replacing the live set', () => {
  const a = canvases(), b = canvases(), owner = binding();
  owner.rebind(a);
  vi.mocked(context(b.parade).configure).mockImplementation(() => { throw new Error('configure failed'); });
  expect(() => owner.rebind(b)).toThrow('configure failed');
  expect(owner.canvases).toEqual(a);
  expect(owner.isCurrent()).toBe(true);
  expect(context(b.hueDistribution).unconfigure).toHaveBeenCalledOnce();
  expect(context(a.hueDistribution).unconfigure).not.toHaveBeenCalled();
});

it('retiring an old owner cannot unconfigure its successor on the same DOM canvases', () => {
  const a = canvases(), old = binding(), next = binding();
  old.rebind(a); next.rebind(a);
  expect(old.isCurrent()).toBe(false);
  old.dispose(); old.dispose();
  expect(context(a.parade).unconfigure).not.toHaveBeenCalled();
  expect(next.isCurrent()).toBe(true);
  next.dispose();
  expect(context(a.parade).unconfigure).toHaveBeenCalledOnce();
  expect(() => next.rebind(a)).toThrow('disposed');
});

it('failed foreign-context transfer restores the old device even for the configure call that threw', () => {
  const a = canvases(), oldDevice = {} as GPUDevice, newDevice = {} as GPUDevice;
  const old = new ScopeCanvasBinding(oldDevice, 'bgra8unorm', vi.fn());
  const next = new ScopeCanvasBinding(newDevice, 'rgba8unorm', vi.fn());
  old.rebind(a);
  vi.mocked(context(a.parade).configure).mockImplementationOnce(() => { throw new Error('transfer failed'); });
  expect(() => next.rebind(a)).toThrow('transfer failed');
  expect(old.isCurrent()).toBe(true); expect(next.isCurrent()).toBe(false);
  expect(context(a.hueDistribution).configure).toHaveBeenLastCalledWith(expect.objectContaining({ device: oldDevice, format: 'bgra8unorm' }));
  expect(context(a.parade).configure).toHaveBeenLastCalledWith(expect.objectContaining({ device: oldDevice, format: 'bgra8unorm' }));
  expect(context(a.hueDistribution).unconfigure).not.toHaveBeenCalled();
});

it('reclaiming identical DOM canvases immediately refreshes the displaced theme', () => {
  let light = false;
  theme.observe.mockImplementation((_canvas, publish) => { publish({ light, background: [0, 0, 0] }); return vi.fn(); });
  const a = canvases(), publish = vi.fn(), old = binding(publish), next = binding();
  old.rebind(a); next.rebind(a); light = true;
  theme.observe.mock.calls[0][1]({ light: true } as ScopeTheme);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ light: false }));
  old.rebind(a);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ light: true }));
});
