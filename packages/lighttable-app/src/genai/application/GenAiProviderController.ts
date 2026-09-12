import type { GenAiProviderId, GenAiProviderSnapshot } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';

export type GenAiProviderService = Pick<LightTableGenAiService,
  'getProviderSnapshots' | 'subscribe' | 'connectProvider' | 'disconnectProvider'>;
export interface GenAiProviderPreferences { readonly createProviderId: string; readonly editProviderId: string }
export interface GenAiProvidersSnapshot {
  readonly selectedProviderId: GenAiProviderId;
  readonly editProviderId: GenAiProviderId;
  readonly provider: GenAiProviderSnapshot;
  readonly openArtProvider: GenAiProviderSnapshot;
}
const openArtId = 'openart' as GenAiProviderId;
const placeholder = (id: GenAiProviderId): GenAiProviderSnapshot => ({ id,
  label: id === 'lighttable-local' ? 'Free Local AI' : id === 'higgsfield' ? 'Higgsfield' : 'OpenArt', status: 'disconnected' });
const same = (a: GenAiProviderSnapshot | undefined, b: GenAiProviderSnapshot) => a?.id === b.id
  && a.label === b.label && a.status === b.status && a.message === b.message && a.connectedAt === b.connectedAt;

/** Provider-only projection and request lifetime. Authentication and event ordering remain host-owned. */
export class GenAiProviderController {
  private readonly providers = new Map<GenAiProviderId, GenAiProviderSnapshot>();
  private readonly versions = new Map<GenAiProviderId, number>();
  private readonly terminalEvents = new Map<GenAiProviderId, number>();
  private readonly requests = new Map<GenAiProviderId, symbol>();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private mounted = false;
  private snapshot: GenAiProvidersSnapshot;
  constructor(private readonly service: GenAiProviderService | undefined,
    preferences: GenAiProviderPreferences | undefined, private readonly isBound: () => boolean,
    private readonly getReportFailure: () => (message: string) => void) {
    const selectedProviderId = (preferences?.createProviderId || openArtId) as GenAiProviderId;
    const editProviderId = (preferences?.editProviderId || openArtId) as GenAiProviderId;
    this.snapshot = { selectedProviderId, editProviderId, provider: placeholder(selectedProviderId), openArtProvider: placeholder(openArtId) };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() {
    const { selectedProviderId, editProviderId } = this.snapshot;
    this.snapshot = { selectedProviderId, editProviderId,
      provider: this.providers.get(selectedProviderId) ?? placeholder(selectedProviderId),
      openArtProvider: this.providers.get(openArtId) ?? placeholder(openArtId) };
    this.listeners.forEach(listener => listener());
  }
  setPreferences = (preferences: GenAiProviderPreferences | undefined) => {
    const selectedProviderId = (preferences?.createProviderId || openArtId) as GenAiProviderId;
    const editProviderId = (preferences?.editProviderId || openArtId) as GenAiProviderId;
    if (selectedProviderId === this.snapshot.selectedProviderId && editProviderId === this.snapshot.editProviderId) return;
    // Preserve the actual Create-preference policy; workflow mode does not select a provider here.
    this.snapshot = { ...this.snapshot, selectedProviderId, editProviderId }; this.publish();
  };
  private touch(id: GenAiProviderId) { this.versions.set(id, (this.versions.get(id) ?? 0) + 1); }
  private update(snapshot: GenAiProviderSnapshot) {
    this.touch(snapshot.id);
    if (same(this.providers.get(snapshot.id), snapshot)) return;
    this.providers.set(snapshot.id, snapshot); this.publish();
  }
  private failure(id: GenAiProviderId, reason: unknown, isCurrent: () => boolean, report?: (message: string) => void) {
    if (!isCurrent()) return;
    const message = reason instanceof Error ? reason.message : String(reason);
    this.update({ ...(this.providers.get(id) ?? placeholder(id)), status: 'error', message });
    if (isCurrent()) report?.(message);
  }
  start = () => {
    const epoch = ++this.epoch; this.mounted = true;
    const isCurrent = () => this.mounted && this.epoch === epoch && this.isBound();
    const baseline = new Map(this.versions), selected = this.snapshot.selectedProviderId;
    let unsubscribe: (() => void) | undefined;
    if (this.service && isCurrent()) {
      try {
        unsubscribe = this.service.subscribe(snapshot => {
          if (!isCurrent()) return;
          if (snapshot.status !== 'connecting') this.terminalEvents.set(snapshot.id, (this.terminalEvents.get(snapshot.id) ?? 0) + 1);
          this.update(snapshot);
        });
        void this.service.getProviderSnapshots().then(snapshots => {
          if (!isCurrent()) return;
          for (const snapshot of snapshots) {
            if (!isCurrent()) return;
            if ((this.versions.get(snapshot.id) ?? 0) === (baseline.get(snapshot.id) ?? 0)) this.update(snapshot);
          }
        }).catch(reason => {
          if (isCurrent() && (this.versions.get(selected) ?? 0) === (baseline.get(selected) ?? 0)) this.failure(selected, reason, isCurrent);
        });
      } catch (reason) { this.failure(selected, reason, isCurrent); }
    }
    return () => {
      if (this.epoch === epoch) { this.mounted = false; this.epoch++; }
      unsubscribe?.();
    };
  };
  private async request(id: GenAiProviderId, operation: 'connectProvider' | 'disconnectProvider'): Promise<void> {
    const epoch = this.epoch, service = this.service, token = Symbol(id);
    const isCurrent = () => this.mounted && this.isBound() && this.epoch === epoch && this.requests.get(id) === token;
    if (!service || !this.mounted || !this.isBound()) return;
    const reportFailure = this.getReportFailure(), terminalVersion = this.terminalEvents.get(id) ?? 0;
    // Observed terminal events outrank an older request response; connecting is progress.
    // The host provides no operation identity, so event-versus-event ordering stays host-owned.
    const retainTerminalEvent = () => {
      if ((this.terminalEvents.get(id) ?? 0) === terminalVersion) return false;
      const current = this.providers.get(id);
      if (current?.status === 'error' && isCurrent()) reportFailure(current.message ?? `${current.label} connection failed.`);
      return true;
    };
    this.requests.set(id, token); this.touch(id);
    try {
      const snapshot = await service[operation](id);
      if (!isCurrent()) return;
      if (retainTerminalEvent()) return;
      if (snapshot.id !== id) throw new Error('The provider returned a connection status for a different provider.');
      this.update(snapshot);
      if (snapshot.status === 'error' && isCurrent()) reportFailure(snapshot.message ?? `${snapshot.label} connection failed.`);
    } catch (reason) {
      if (isCurrent() && !retainTerminalEvent()) this.failure(id, reason, isCurrent, reportFailure);
    }
  }
  connectSelected = () => this.request(this.snapshot.selectedProviderId, 'connectProvider');
  connectOpenArt = () => this.request(openArtId, 'connectProvider');
  disconnectOpenArt = () => this.request(openArtId, 'disconnectProvider');
}
