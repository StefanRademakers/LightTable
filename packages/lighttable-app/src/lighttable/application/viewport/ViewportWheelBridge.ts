import { resolveWheelPanDeltas } from '../../editor/tools/pointer/viewportCoordinates';

export interface ViewportWheelBridgePorts {
  active: boolean;
  zoomWithScrollWheel: boolean;
  viewport: Pick<HTMLElement, 'getBoundingClientRect'> | null;
  pan(input: { deltaX: number; deltaY?: number }): void;
  report(level: 'info', source: string, message: string, detail: string): void;
}

/** Owns host wheel listeners only. The viewport owner still applies pan and zoom. */
export class ViewportWheelBridge {
  private samples = 0;
  constructor(private readonly read: () => ViewportWheelBridgePorts) {}

  connect(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    let connected = true;
    const inside = (p: ViewportWheelBridgePorts, x: number, y: number) => {
      if (!connected || !p.active || !p.viewport) return false;
      const rect = p.viewport.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    const report = (p: ViewportWheelBridgePorts, message: string, detail: () => string) => {
      if (this.samples >= 20) return;
      this.samples += 1;
      p.report('info', 'Viewport input', message, `sample=${this.samples} ${detail()}`);
    };
    const desktop = (event: Event) => {
      const p = this.read();
      const detail = (event as CustomEvent<{ clientX?: number; clientY?: number; deltaX?: number }>).detail;
      if (!detail || !Number.isFinite(detail.clientX) || !Number.isFinite(detail.clientY)
        || !Number.isFinite(detail.deltaX) || !inside(p, detail.clientX!, detail.clientY!)) return;
      report(p, 'Electron horizontal wheel bridge received.',
        () => `deltaX=${detail.deltaX} client=(${detail.clientX},${detail.clientY})`);
      p.pan({ deltaX: detail.deltaX! });
    };
    const renderer = (input: Event) => {
      const p = this.read();
      const event = input as WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number };
      if (!connected || !p.active || p.zoomWithScrollWheel || event.ctrlKey || event.metaKey) return;
      const delta = resolveWheelPanDeltas({ deltaX: event.deltaX, deltaY: event.deltaY,
        legacyWheelDeltaX: event.wheelDeltaX, shiftKey: event.shiftKey });
      if (delta.deltaX === 0 || !inside(p, event.clientX, event.clientY)) return;
      report(p, 'Renderer wheel event captured.',
        () => `delta=(${event.deltaX},${event.deltaY}) legacy=(${event.wheelDeltaX ?? 0},${event.wheelDeltaY ?? 0}) `
        + `resolved=(${delta.deltaX},${delta.deltaY}) mode=${event.deltaMode} `
        + `shift=${event.shiftKey} ctrl=${event.ctrlKey} meta=${event.metaKey} `
        + `trusted=${event.isTrusted} target=${event.target instanceof Element ? event.target.className : 'unknown'}`);
      event.preventDefault();
      p.pan(delta);
    };
    target.addEventListener('lighttable:desktop-horizontal-wheel', desktop);
    target.addEventListener('wheel', renderer, { capture: true, passive: false });
    return () => {
      connected = false;
      target.removeEventListener('lighttable:desktop-horizontal-wheel', desktop);
      target.removeEventListener('wheel', renderer, true);
    };
  }
}
