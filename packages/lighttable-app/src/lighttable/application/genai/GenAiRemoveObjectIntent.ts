import type { ExecuteRemoveObjectOptions } from '../../../genai/application/removeObjectCommand';
import { executeRemoveObject } from '../../../genai/application/removeObjectCommand';

export interface RemoveObjectRequestContext extends Omit<ExecuteRemoveObjectOptions, 'assertCurrent' | 'prepareSource'> {
  isCurrent(): boolean;
  prepareSource(assertCurrent: () => void): ReturnType<ExecuteRemoveObjectOptions['prepareSource']>;
}

/** Mounted intent lifetime only. GenAI owns discovery, durable assets and submission. */
export class GenAiRemoveObjectIntent {
  private mounted = false;
  private epoch = 0;
  private pending: { isCurrent(): boolean } | null = null;
  constructor(private readonly ports: {
    capture(): RemoveObjectRequestContext;
    status(message: string | null): void;
    error(message: string | null): void;
  }) {}

  readonly connect = (): (() => void) => {
    this.mounted = true;
    const epoch = ++this.epoch;
    return () => {
      if (this.epoch !== epoch) return;
      this.mounted = false; ++this.epoch; this.pending = null;
    };
  };

  readonly run = async (): Promise<void> => {
    if (!this.mounted || this.pending?.isCurrent()) return;
    let context: RemoveObjectRequestContext;
    try { context = this.ports.capture(); }
    catch (reason) { this.ports.error(reason instanceof Error ? reason.message : String(reason)); return; }
    const epoch = this.epoch;
    const request = { isCurrent: () => this.mounted && this.epoch === epoch && context.isCurrent() };
    if (!request.isCurrent()) return;
    const assertCurrent = () => {
      if (!request.isCurrent()) throw new Error('The Remove Object request belongs to a retired document or project.');
    };
    this.pending = request;
    this.ports.error(null); this.ports.status('Removing the selected object...');
    try {
      await executeRemoveObject({ ...context, assertCurrent,
        prepareSource: () => context.prepareSource(assertCurrent) });
      if (request.isCurrent()) this.ports.status('Remove Object submitted.');
    } catch (reason) {
      if (request.isCurrent()) {
        this.ports.status(null);
        this.ports.error(reason instanceof Error ? reason.message : String(reason));
      }
    } finally { if (this.pending === request) this.pending = null; }
  };
}
