import type { ImageDocument } from '../../editor/document/documentTypes';
import { reconcilePropertiesTarget, type PropertiesInspectorTarget } from './propertiesInspectorTarget';

export interface PropertiesPresentationTicket {
  isCurrent(): boolean;
  show(target: PropertiesInspectorTarget): void;
}
export interface PropertiesPresentationPorts {
  capture(): { isCurrent(): boolean; reveal(): void };
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}
const equalTarget = (a: PropertiesInspectorTarget, b: PropertiesInspectorTarget) =>
  JSON.stringify(a) === JSON.stringify(b);

/** UI target and deferred panel focus only; never owns document or edit transactions. */
export class PropertiesInspectorPresentation {
  readonly targetRef: { current: PropertiesInspectorTarget } = { current: { kind: 'none' } };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private intentEpoch = 0;
  private mounted = false;
  private pending: number | null = null;
  constructor(private readonly ports: PropertiesPresentationPorts) {}
  getSnapshot = () => this.targetRef.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  mount = () => { this.mounted = true; };
  retire = () => { this.mounted = false; this.invalidate(); };
  invalidate = () => {
    this.intentEpoch++;
    this.invalidateProjection();
  };
  private invalidateProjection = () => {
    this.epoch++;
    if (this.pending !== null) this.ports.cancel(this.pending);
    this.pending = null;
  };
  private publish(target: PropertiesInspectorTarget) {
    if (equalTarget(target, this.targetRef.current)) return;
    this.targetRef.current = target;
    for (const listener of this.listeners) listener();
  }
  reconcile = (document: ImageDocument | null) => {
    const target = reconcilePropertiesTarget(document, this.targetRef.current);
    if (equalTarget(target, this.targetRef.current)) return;
    this.invalidateProjection(); this.publish(target);
  };
  /** Synchronous canonical publication may reconcile the target, but is not a new user intent. */
  captureMutationIntent = (): PropertiesPresentationTicket => {
    this.invalidate();
    const epoch = this.intentEpoch, context = this.ports.capture();
    const isCurrent = () => this.mounted && epoch === this.intentEpoch && context.isCurrent();
    return { isCurrent, show: target => { if (isCurrent()) this.show(target); } };
  };
  beginIntent = (): PropertiesPresentationTicket => {
    this.invalidate();
    const epoch = this.epoch, context = this.ports.capture();
    const isCurrent = () => this.mounted && epoch === this.epoch && context.isCurrent();
    return { isCurrent, show: target => {
      if (!isCurrent()) return;
      this.publish(target);
      if (!isCurrent()) return;
      if (this.pending !== null) this.ports.cancel(this.pending);
      this.pending = this.ports.schedule(() => {
        if (!isCurrent()) return;
        this.pending = null; context.reveal();
      });
    } };
  };
  show = (target: PropertiesInspectorTarget) => this.beginIntent().show(target);
}
