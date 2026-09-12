import { afterEach, expect, it, vi } from 'vitest';
import { ViewportWheelBridge, type ViewportWheelBridgePorts } from './ViewportWheelBridge';

afterEach(() => vi.unstubAllGlobals());
const fixture = () => {
  vi.stubGlobal('Element', class {});
  const handlers = new Map<string, EventListener>();
  const target = { addEventListener: vi.fn((name: string, handler: EventListener) => handlers.set(name, handler)),
    removeEventListener: vi.fn((name: string) => handlers.delete(name)) };
  let ports: ViewportWheelBridgePorts = { active: true, zoomWithScrollWheel: false,
    viewport: { getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, bottom: 120 }) as DOMRect },
    pan: vi.fn(), report: vi.fn() };
  const owner = new ViewportWheelBridge(() => ports);
  const disconnect = owner.connect(target as unknown as Window);
  const send = (type: string, data: object) => {
    const event = Object.assign(new Event(type, { cancelable: true }), data);
    handlers.get(type)?.(event); return event;
  };
  return { owner, target, handlers, disconnect, send, read: () => ports,
    change: (update: Partial<ViewportWheelBridgePorts>) => { ports = { ...ports, ...update }; } };
};

it('validates native bridge coordinates and routes to the current viewport owner', () => {
  const f = fixture();
  f.send('lighttable:desktop-horizontal-wheel', { detail: { clientX: NaN, clientY: 30, deltaX: 5 } });
  f.send('lighttable:desktop-horizontal-wheel', { detail: { clientX: 0, clientY: 30, deltaX: 5 } });
  expect(f.read().pan).not.toHaveBeenCalled();
  const successor = vi.fn(); f.change({ pan: successor });
  f.send('lighttable:desktop-horizontal-wheel', { detail: { clientX: 30, clientY: 30, deltaX: 5 } });
  expect(successor).toHaveBeenCalledWith({ deltaX: 5 });
  f.change({ active: false });
  f.send('lighttable:desktop-horizontal-wheel', { detail: { clientX: 30, clientY: 30, deltaX: 8 } });
  expect(successor).toHaveBeenCalledTimes(1);
});

it('captures only horizontal pan, preserving zoom/modifier/outside wheel delivery', () => {
  const f = fixture(); const base = { clientX: 30, clientY: 30, deltaX: 5, deltaY: 0,
    deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };
  expect(f.send('wheel', { ...base, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(f.send('wheel', { ...base, clientX: 0 }).defaultPrevented).toBe(false);
  expect(f.send('wheel', { ...base, deltaX: 0, deltaY: 8 }).defaultPrevented).toBe(false);
  f.change({ zoomWithScrollWheel: true });
  expect(f.send('wheel', base).defaultPrevented).toBe(false);
  f.change({ zoomWithScrollWheel: false });
  expect(f.send('wheel', base).defaultPrevented).toBe(true);
  expect(f.read().pan).toHaveBeenCalledTimes(1);
  expect(f.read().pan).toHaveBeenCalledWith({ deltaX: 5, deltaY: 0 });
});

it('retires listeners exactly and a retained event callback cannot pan after cleanup', () => {
  const f = fixture(); const retained = f.handlers.get('lighttable:desktop-horizontal-wheel')!;
  f.disconnect();
  retained(Object.assign(new Event('native'), { detail: { clientX: 30, clientY: 30, deltaX: 5 } }));
  expect(f.read().pan).not.toHaveBeenCalled();
  expect(f.target.removeEventListener).toHaveBeenCalledTimes(2);
  expect(f.target.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), true);
});

it('keeps the diagnostic budget bounded across reconnects', () => {
  const f = fixture();
  for (let i = 0; i < 24; i++) f.send('lighttable:desktop-horizontal-wheel',
    { detail: { clientX: 30, clientY: 30, deltaX: 5 } });
  expect(f.read().pan).toHaveBeenCalledTimes(24);
  expect(f.read().report).toHaveBeenCalledTimes(20);
  const className = vi.fn(() => 'canvas');
  const diagnosticTarget = new Element();
  Object.defineProperty(diagnosticTarget, 'className', { get: className });
  const wheel = Object.assign(new Event('wheel', { cancelable: true }), {
    clientX: 30, clientY: 30, deltaX: 5, deltaY: 0, shiftKey: false
  });
  Object.defineProperty(wheel, 'target', { value: diagnosticTarget });
  f.handlers.get('wheel')!(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(className).not.toHaveBeenCalled();
  f.disconnect(); f.owner.connect(f.target as unknown as Window);
  f.send('lighttable:desktop-horizontal-wheel', { detail: { clientX: 30, clientY: 30, deltaX: 5 } });
  expect(f.read().report).toHaveBeenCalledTimes(20);
});
