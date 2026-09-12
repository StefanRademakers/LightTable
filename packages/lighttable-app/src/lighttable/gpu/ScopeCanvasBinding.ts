import { observeScopeTheme, type ScopeTheme } from '@lighttable/ui/scopeRendering';
import type { DocumentRendererScopeCanvases } from '../application/rendering/rendererTypes';

const roles = ['hueDistribution', 'colorMixerHueDistribution', 'parade', 'vectorscope'] as const;
type Role = typeof roles[number];
type Contexts = Record<Role, GPUCanvasContext | null>;
// A retiring renderer may share a DOM canvas with its successor. Only its exact
// current owner may unconfigure that context or write to its presentation surface.
const owners = new WeakMap<GPUCanvasContext, ScopeCanvasBinding>();

/** DOM/context/theme ownership only; analysis buffers and pipelines stay in the scope engine. */
export class ScopeCanvasBinding {
  private current: DocumentRendererScopeCanvases | null = null;
  private contexts: Contexts = { hueDistribution: null, colorMixerHueDistribution: null, parade: null, vectorscope: null };
  private stopTheme: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly onTheme: (theme: ScopeTheme) => void
  ) {}

  get canvases(): DocumentRendererScopeCanvases {
    if (!this.current) throw new Error('Scope canvases have not been attached.');
    return this.current;
  }

  context(role: Role): GPUCanvasContext | null { return this.contexts[role]; }

  isCurrent(): boolean {
    return !this.disposed && this.current !== null && roles.every(role => {
      const context = this.contexts[role];
      return !context || owners.get(context) === this;
    });
  }

  rebind(canvases: DocumentRendererScopeCanvases): boolean {
    if (this.disposed) throw new Error('Cannot attach canvases to a disposed scope binding.');
    const wasCurrent = this.isCurrent();
    if (wasCurrent && roles.every(role => this.current?.[role] === canvases[role])) return false;
    const next = {} as Contexts;
    // Validate the complete request before replacing any current surface.
    for (const role of roles) {
      next[role] = canvases[role]?.getContext('webgpu') ?? null;
      if ((role !== 'colorMixerHueDistribution' || canvases[role]) && !next[role]) {
        throw new Error(`The browser could not create the ${role} scope canvas.`);
      }
    }
    const attempted: Array<{ context: GPUCanvasContext; owner?: ScopeCanvasBinding }> = [];
    try {
      for (const context of new Set(Object.values(next))) {
        if (!context || owners.get(context) === this) continue;
        attempted.push({ context, owner: owners.get(context) });
        this.configure(context);
      }
    } catch (error) {
      const failures: unknown[] = [error];
      for (const { context, owner } of attempted.reverse()) {
        // configure can have side effects before throwing. Restore the previous
        // concrete device/format, not merely its ownership-map entry.
        try {
          if (owner) owner.configure(context);
          else { owners.delete(context); context.unconfigure(); }
        } catch (restoreError) { owners.delete(context); failures.push(restoreError); }
      }
      if (failures.length > 1) throw new AggregateError(failures, 'Scope canvas transfer and restoration failed.');
      throw error;
    }
    const previousHue = this.current?.hueDistribution;
    for (const context of new Set(Object.values(this.contexts))) {
      if (context && !Object.values(next).includes(context)) this.release(context);
    }
    this.current = { ...canvases };
    this.contexts = next;
    if (!wasCurrent || previousHue !== canvases.hueDistribution) {
      this.stopTheme?.();
      const hue = canvases.hueDistribution;
      this.stopTheme = observeScopeTheme(hue, theme => {
        if (this.current?.hueDistribution === hue && this.isCurrent()) this.onTheme(theme);
      });
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTheme?.();
    this.stopTheme = null;
    for (const context of new Set(Object.values(this.contexts))) if (context) this.release(context);
    this.current = null;
  }

  private release(context: GPUCanvasContext): void {
    if (owners.get(context) !== this) return;
    owners.delete(context);
    context.unconfigure();
  }

  private configure(context: GPUCanvasContext): void {
    context.configure({ device: this.device, format: this.format, alphaMode: 'opaque', colorSpace: 'srgb' });
    owners.set(context, this);
  }
}
