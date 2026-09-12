import type { DocumentGuide, ImageDocument } from '../../../editor/document/documentTypes';
import { addDocumentGuide, clearDocumentGuides, removeDocumentGuide, updateDocumentGuide } from '../../../editor/document/guideCommands';
import type { DocumentMutationController } from '../../documents/useDocumentMutationController';
import { quantizeGuideToRulerTick } from './rulerTicks';

export interface GuidePointerSample { x: number; y: number; scale: number; altKey: boolean; shiftKey: boolean }
export interface DocumentGuideLease {
  isCurrent(): boolean;
  move(sample: GuidePointerSample): void;
  finish(sample: GuidePointerSample, inside: boolean): void;
  cancel(): void;
}
export interface DocumentGuideInteractionPorts {
  capture(): { isCurrent(): boolean; getDocument(): ImageDocument | null };
  changeDocument: DocumentMutationController['change'];
  reportFailure(message: string): void;
}

/** Owns only transient guide intent. Canonical helpers and document mutation own accepted history. */
export class DocumentGuideInteraction {
  private draft: readonly DocumentGuide[] | null = null;
  private listeners = new Set<() => void>();
  private active: DocumentGuideLease | null = null;
  constructor(private readonly ports: DocumentGuideInteractionPorts) {}
  getSnapshot = () => this.draft;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(draft: readonly DocumentGuide[] | null) {
    this.draft = draft;
    for (const listener of this.listeners) listener();
  }
  cancel = () => { const active = this.active; this.active = null; if (active || this.draft) this.publish(null); };
  synchronize = () => { if (this.active && !this.active.isCurrent()) this.cancel(); };
  private capture() {
    const scope = this.ports.capture(), opening = scope.getDocument();
    const isCurrent = () => {
      const current = scope.getDocument();
      return Boolean(opening && scope.isCurrent() && current?.id === opening.id
        && current.guides === opening.guides && current.width === opening.width && current.height === opening.height);
    };
    return { opening, isCurrent, ownsContext: scope.isCurrent };
  }
  beginExisting = (id: string): DocumentGuideLease | null => this.begin(id);
  beginNew = (orientation: DocumentGuide['orientation']): DocumentGuideLease | null => this.begin(null, orientation);
  private begin(id: string | null, orientation?: DocumentGuide['orientation']): DocumentGuideLease | null {
    this.cancel();
    const source = this.capture(), opening = source.opening;
    if (!opening || !source.isCurrent()) return null;
    const original = id ? opening.guides.find(guide => guide.id === id) : undefined;
    if (id && !original) return null;
    const guide: DocumentGuide = original ?? { id: `guide-${crypto.randomUUID()}`, orientation: orientation!, position: 0 };
    const resolve = (sample: GuidePointerSample): DocumentGuide => {
      const orientation = sample.altKey ? guide.orientation === 'horizontal' ? 'vertical' : 'horizontal' : guide.orientation;
      const raw = orientation === 'vertical' ? sample.x : sample.y;
      const length = orientation === 'vertical' ? opening.width : opening.height;
      return { ...guide, orientation, position: sample.shiftKey ? quantizeGuideToRulerTick(raw, length, sample.scale) : raw };
    };
    let lastPreview: DocumentGuide | undefined;
    const lease: DocumentGuideLease = {
      isCurrent: () => this.active === lease && source.isCurrent(),
      move: sample => {
        if (!lease.isCurrent()) { lease.cancel(); return; }
        const next = resolve(sample);
        if (lastPreview?.orientation === next.orientation && lastPreview.position === next.position) return;
        lastPreview = next;
        this.publish(original ? opening.guides.map(item => item.id === id ? next : item) : [...opening.guides, next]);
      },
      finish: (sample, inside) => {
        if (!lease.isCurrent()) { lease.cancel(); return; }
        // Retain the draft through canonical publication; retirement cannot cancel this terminal twice.
        this.active = null;
        try {
          const next = resolve(sample);
          this.commit(source, document => inside
            ? original ? updateDocumentGuide(document, guide.id, next) : addDocumentGuide(document, next)
            : original ? removeDocumentGuide(document, guide.id) : document, 'Edit Guides');
        } finally { if (!this.active) this.publish(null); }
      },
      cancel: () => { if (this.active === lease) this.cancel(); }
    };
    this.active = lease;
    return lease;
  }
  private commit(source: { isCurrent(): boolean; ownsContext(): boolean }, mutate: (document: ImageDocument) => ImageDocument, label: string) {
    const { isCurrent } = source;
    if (!isCurrent()) return;
    try {
      // Admission can reject before invoking mutate; derive the intended no-op first.
      const scope = this.ports.capture(), current = scope.getDocument();
      if (!current || !isCurrent()) return;
      const intended = mutate(current), changed = intended !== current;
      if (!changed) return;
      const accepted = this.ports.changeDocument(document => {
        if (!isCurrent()) throw new Error('The guide edit source is no longer current.');
        return document === current ? intended : mutate(document);
      }, true, { label, type: 'document.guides' });
      if (!accepted && changed) throw new Error('The guide edit could not be committed.');
    } catch (reason) {
      if (source.ownsContext()) this.ports.reportFailure(reason instanceof Error ? reason.message : String(reason));
    }
  }
  add = (guide: Omit<DocumentGuide, 'id'> & { id?: string }) => {
    this.cancel(); const source = this.capture();
    this.commit(source, document => addDocumentGuide(document, guide), 'New Guide');
  };
  clear = () => {
    this.cancel(); const source = this.capture();
    this.commit(source, clearDocumentGuides, 'Clear Guides');
  };
}
