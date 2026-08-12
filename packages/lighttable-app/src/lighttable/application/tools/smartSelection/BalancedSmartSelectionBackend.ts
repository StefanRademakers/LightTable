import type {
  PreparedSmartSelectionSource, SmartSelectionBackend, SmartSelectionPrompt,
  SmartSelectionRequestOptions, SmartSelectionSource
} from './SmartSelectionBackend';
import { Sam2SmartSelectionBackend } from './Sam2SmartSelectionBackend';
import { SlimSamSmartSelectionBackend } from './SlimSamSmartSelectionBackend';

interface PreparedRoute {
  readonly backend: SmartSelectionBackend;
  readonly source: SmartSelectionSource;
  readonly prepared: PreparedSmartSelectionSource;
}

/** Balanced profile: SAM 2.1 Small prompts with a lazy SlimSAM compatibility fallback. */
export class BalancedSmartSelectionBackend implements SmartSelectionBackend {
  readonly identity;
  readonly capabilities = {
    positivePoints: true, negativePoints: true, boxes: true,
    previousMask: false, automaticSubject: true
  } as const;
  private readonly primary = new Sam2SmartSelectionBackend();
  private readonly fallback = new SlimSamSmartSelectionBackend();
  private readonly routes = new Map<string, PreparedRoute>();
  private primaryUnavailable = false;

  constructor() { this.identity = this.primary.identity; }

  async prepare(source: SmartSelectionSource, signal?: AbortSignal) {
    let backend: SmartSelectionBackend = this.primaryUnavailable ? this.fallback : this.primary;
    let prepared: PreparedSmartSelectionSource;
    try {
      prepared = await backend.prepare(source, signal);
    } catch (reason) {
      if (backend === this.fallback || signal?.aborted) throw reason;
      this.primaryUnavailable = true;
      backend = this.fallback;
      prepared = await backend.prepare(source, signal);
    }
    const routed = { ...prepared, id: `${backend === this.primary ? 'sam2' : 'slimsam'}|${prepared.id}` };
    this.routes.set(routed.id, { backend, source, prepared });
    return routed;
  }

  selectPrompt(source: PreparedSmartSelectionSource, prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions) {
    const route = this.route(source);
    return route.backend.selectPrompt(route.prepared, prompt, options);
  }

  async selectSubject(source: PreparedSmartSelectionSource, options: SmartSelectionRequestOptions) {
    const route = this.route(source);
    if (route.backend === this.fallback) return this.fallback.selectSubject(route.prepared, options);
    const prepared = await this.fallback.prepare(route.source, options.signal);
    return this.fallback.selectSubject(prepared, options);
  }

  disposePreparedSource(source: PreparedSmartSelectionSource) {
    const route = this.routes.get(source.id);
    if (!route) return;
    route.backend.disposePreparedSource(route.prepared);
    this.routes.delete(source.id);
  }
  dispose() { this.routes.clear(); this.primary.dispose(); this.fallback.dispose(); }
  private route(source: PreparedSmartSelectionSource) {
    const route = this.routes.get(source.id);
    if (!route) throw new Error('The prepared Object Selection source is no longer available.');
    return route;
  }
}
