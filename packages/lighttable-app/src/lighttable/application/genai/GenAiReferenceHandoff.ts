import type { GenAiAssetReference } from '@lighttable/genai-core';
import type { GenAiAssetReferenceImportLease } from '../../../genai/application/GenAiAssetReferenceImport';

export interface GenAiReferenceContext {
  readonly projectId: string | undefined;
  readonly documentId: string;
  readonly active: boolean;
  readonly selectedMode: string;
  readonly workflow: object | undefined;
  readonly imageEditReady: boolean;
}
export interface GenAiReferenceSource {
  isCurrent(): boolean;
  exportPng(): Promise<File>;
}
export interface GenAiReferenceHandoffPorts {
  readContext(): GenAiReferenceContext;
  captureImport(isCurrent: () => boolean): GenAiAssetReferenceImportLease;
  captureSource(documentId: string): GenAiReferenceSource | undefined;
  documentState(documentId: string): 'missing' | 'pending' | 'failed' | 'ready';
  activateDocument(documentId: string): void;
  reportError(message: string): void;
}
export interface GenAiReferenceSnapshot {
  readonly baseImageSelected: boolean;
  readonly baseImageAssetId: GenAiAssetReference['id'] | undefined;
  readonly pendingTabReference: boolean;
}
type TabRequest = { id: string; origin: string; lease: GenAiAssetReferenceImportLease; source?: GenAiReferenceSource };
type BaseAttempt = { workflow: object | undefined; lease?: GenAiAssetReferenceImportLease };

/** Owns reference-purpose handoff, not asset persistence, workflow fields or provider jobs. */
export class GenAiReferenceHandoff {
  private mounted = false;
  private epoch = 0;
  private mode: string | undefined;
  private projectId: string | undefined;
  private documentId: string | undefined;
  private asset: GenAiAssetReference | undefined;
  private attachment: { workflow: object | undefined; lease: GenAiAssetReferenceImportLease } | undefined;
  private baseAttempt: BaseAttempt | undefined;
  private tab: TabRequest | undefined;
  private snapshot: GenAiReferenceSnapshot = { baseImageSelected: false,
    baseImageAssetId: undefined, pendingTabReference: false };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly ports: GenAiReferenceHandoffPorts) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  connect = () => {
    this.mounted = true;
    return () => { this.mounted = false; this.epoch++; this.tab = undefined; this.baseAttempt = undefined;
      this.attachment = undefined;
      this.publish({ pendingTabReference: false }); };
  };
  private publish(change: Partial<GenAiReferenceSnapshot>) {
    const next = { ...this.snapshot, ...change };
    if (Object.keys(next).every(key => next[key as keyof typeof next] === this.snapshot[key as keyof typeof next])) return;
    this.snapshot = next; this.listeners.forEach(listener => listener());
  }
  private currentLifetime() {
    const epoch = this.epoch;
    return () => this.mounted && this.epoch === epoch;
  }
  private currentAssociation() {
    const lifetime = this.currentLifetime(), context = this.ports.readContext();
    return () => lifetime() && this.ports.readContext().projectId === context.projectId
      && this.ports.readContext().documentId === context.documentId;
  }
  private clearBase() {
    if (this.asset?.projectId === (this.ports.readContext().projectId ?? '')) {
      this.ports.captureImport(this.currentAssociation()).removeReference(this.asset.id);
    }
    this.asset = undefined; this.attachment = undefined; this.baseAttempt = undefined;
    this.publish({ baseImageAssetId: undefined });
  }
  setBaseImageSelected = (selected: boolean) => {
    if (!this.mounted) return;
    this.publish({ baseImageSelected: selected });
    if (!selected) this.clearBase();
    this.synchronize();
  };
  importFile = async (file: File) => {
    const lease = this.ports.captureImport(this.currentLifetime());
    return this.importWithLease(file, lease);
  };
  private async importWithLease(file: File, lease: GenAiAssetReferenceImportLease) {
    if (!lease.isCurrent()) return undefined;
    const asset = await lease.importFile(file);
    if (!lease.isCurrent()) return undefined;
    if (asset) await lease.requestPreview(asset.id);
    return lease.isCurrent() ? asset : undefined;
  }
  importDocument = async (documentId: string) => {
    const lifetime = this.currentLifetime();
    const source = this.ports.captureSource(documentId);
    const lease = this.ports.captureImport(() => lifetime() && Boolean(source?.isCurrent()));
    if (!source) {
      if (lifetime()) this.ports.reportError('The reference document is not ready for export.');
      return undefined;
    }
    return this.exportReference(source, lease);
  };
  private async exportReference(source: GenAiReferenceSource, lease: GenAiAssetReferenceImportLease) {
    try {
      if (!lease.isCurrent() || !source.isCurrent()) return undefined;
      const file = await source.exportPng();
      if (!lease.isCurrent() || !source.isCurrent()) return undefined;
      return await this.importWithLease(file, lease);
    } catch (reason) {
      if (lease.isCurrent() && source.isCurrent()) this.ports.reportError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  }
  requestTabReference = (documentId: string) => {
    if (!this.mounted || this.ports.documentState(documentId) === 'missing') return;
    const lifetime = this.currentLifetime();
    const request: TabRequest = { id: documentId, origin: this.ports.readContext().documentId,
      lease: undefined! };
    request.lease = this.ports.captureImport(() => lifetime() && this.tab === request
      && (!request.source || request.source.isCurrent())
      && [request.origin, request.id].includes(this.ports.readContext().documentId));
    this.tab = request; this.publish({ pendingTabReference: true });
    if (request.origin !== documentId) this.ports.activateDocument(documentId);
    this.synchronize();
  };
  synchronize = () => {
    if (!this.mounted) return;
    const context = this.ports.readContext();
    if (this.projectId !== context.projectId || this.documentId !== context.documentId) {
      this.clearBase(); this.projectId = context.projectId; this.documentId = context.documentId;
    }
    if (this.mode !== context.selectedMode) {
      this.mode = context.selectedMode;
      this.publish({ baseImageSelected: context.selectedMode === 'image2image' });
      this.baseAttempt = undefined;
    }
    this.advanceTab(context);
    if (!context.active || !this.snapshot.baseImageSelected || !context.imageEditReady) return;
    if (this.asset) {
      if (!this.attachment || this.attachment.workflow !== context.workflow || !this.attachment.lease.isCurrent()) {
        const asset = this.asset, association = this.currentAssociation();
        const lease = this.ports.captureImport(() => association() && this.asset === asset && this.snapshot.baseImageSelected);
        if (lease.addReference(asset)) this.attachment = { workflow: context.workflow, lease };
      }
      return;
    }
    // One attempt per workflow/scope, including failure or source retirement. No revision-driven retry loop.
    if (this.baseAttempt?.workflow === context.workflow) return;
    const source = this.ports.captureSource(context.documentId);
    if (!source) return;
    const lifetime = this.currentLifetime();
    const attempt: BaseAttempt = { workflow: context.workflow };
    this.baseAttempt = attempt;
    const isCurrent = () => lifetime() && this.baseAttempt === attempt && this.snapshot.baseImageSelected
      && this.ports.readContext().documentId === context.documentId
      && this.ports.readContext().projectId === context.projectId && source.isCurrent();
    const lease = this.ports.captureImport(isCurrent); attempt.lease = lease;
    void this.exportReference(source, lease).then(asset => {
      if (asset && lease.isCurrent()) {
        this.asset = asset; this.attachment = undefined;
        this.publish({ baseImageAssetId: asset.id });
        this.synchronize();
      }
    }).finally(() => { if (this.baseAttempt === attempt) attempt.lease = undefined; });
  };
  private advanceTab(context: GenAiReferenceContext) {
    const request = this.tab;
    if (!request) return;
    const state = this.ports.documentState(request.id);
    if (!request.lease.isCurrent() || state === 'missing' || state === 'failed') {
      if (request.lease.isCurrent() && state === 'failed') this.ports.reportError('The reference document could not be opened.');
      this.tab = undefined; this.publish({ pendingTabReference: false }); return;
    }
    if (request.source) return;
    if (context.documentId !== request.id || state !== 'ready') return;
    const source = this.ports.captureSource(request.id);
    if (!source) return;
    request.source = source;
    // The Setup lease predates activation; export source is captured only after target binding is ready.
    this.publish({ pendingTabReference: false });
    // Promise completion is not acknowledgement of deferred React publications.
    // Keep this request's authority until supersession or source/Setup retirement.
    void this.exportReference(source, request.lease);
  }
}
