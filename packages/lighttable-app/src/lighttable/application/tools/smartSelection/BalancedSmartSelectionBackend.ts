import type {
  PreparedSmartSelectionSource, SmartSelectionBackend, SmartSelectionPrompt,
  SmartSelectionBackendStatus, SmartSelectionRequestOptions, SmartSelectionSource
} from './SmartSelectionBackend';
import { Sam2SmartSelectionBackend } from './Sam2SmartSelectionBackend';
import { SlimSamSmartSelectionBackend } from './SlimSamSmartSelectionBackend';

interface PreparedRoute {
  readonly backend: SmartSelectionBackend;
  readonly prepared: PreparedSmartSelectionSource;
}

/** Balanced profile: SAM 2.1 Small prompts with a lazy SlimSAM compatibility fallback. */
export class BalancedSmartSelectionBackend implements SmartSelectionBackend {
  readonly capabilities = {
    positivePoints: true, negativePoints: true, boxes: true,
    previousMask: false, automaticSubject: true
  } as const;
  private readonly primary = new Sam2SmartSelectionBackend();
  private readonly fallback = new SlimSamSmartSelectionBackend();
  private readonly routes = new Map<string, PreparedRoute>();
  private primaryUnavailable = false;
  private activeBackend: SmartSelectionBackend = this.primary;
  private readonly statusListeners = new Set<(status: SmartSelectionBackendStatus) => void>();
  private readonly unsubscribeStatuses = [
    this.primary.subscribeStatus?.((status) => this.publishStatus(status)),
    this.fallback.subscribeStatus?.((status) => this.publishStatus(status))
  ];

  get identity() { return this.activeBackend.identity; }

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
    this.activeBackend = backend;
    const routed = { ...prepared, id: `${backend === this.primary ? 'sam2' : 'slimsam'}|${prepared.id}` };
    this.routes.set(routed.id, { backend, prepared });
    return routed;
  }

  selectPrompt(source: PreparedSmartSelectionSource, prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions) {
    const route = this.route(source);
    this.activeBackend = route.backend;
    return route.backend.selectPrompt(route.prepared, prompt, options);
  }

  async selectSubject(source: PreparedSmartSelectionSource, options: SmartSelectionRequestOptions) {
    const route = this.route(source);
    this.activeBackend = route.backend;
    if (!route.backend.selectSubject) throw new Error('The active selection model cannot select a subject.');
    return route.backend.selectSubject(route.prepared, options);
  }

  subscribeStatus(listener: (status: SmartSelectionBackendStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disposePreparedSource(source: PreparedSmartSelectionSource) {
    const route = this.routes.get(source.id);
    if (!route) return;
    route.backend.disposePreparedSource(route.prepared);
    this.routes.delete(source.id);
  }
  dispose() {
    this.routes.clear();
    for (const unsubscribe of this.unsubscribeStatuses) unsubscribe?.();
    this.statusListeners.clear();
    this.primary.dispose();
    this.fallback.dispose();
  }
  private publishStatus(status: SmartSelectionBackendStatus) {
    for (const listener of this.statusListeners) listener(status);
  }
  private route(source: PreparedSmartSelectionSource) {
    const route = this.routes.get(source.id);
    if (!route) throw new Error('The prepared Object Selection source is no longer available.');
    return route;
  }
}
