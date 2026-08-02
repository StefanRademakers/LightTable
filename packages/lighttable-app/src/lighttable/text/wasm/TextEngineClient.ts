import {
  TEXT_ENGINE_PROTOCOL_VERSION,
  type TextEngineCapability,
  type TextEngineWorkerRequest,
  type TextEngineWorkerResponse
} from './textEngineProtocol';

interface PendingProbe {
  readonly resolve: (capability: TextEngineCapability) => void;
  readonly reject: (reason: Error) => void;
}

export interface TextEngineWorkerPort {
  onmessage: ((event: MessageEvent<TextEngineWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: TextEngineWorkerRequest): void;
  terminate(): void;
}

export type TextEngineWorkerFactory = () => TextEngineWorkerPort;

const createBrowserWorker = (): TextEngineWorkerPort => new Worker(
  new URL('./textLayout.worker.ts', import.meta.url),
  { type: 'module', name: 'LightTable text layout' }
);

/**
 * Lazy application-scoped bridge to the Rust/WASM text engine.
 *
 * Construction and module import perform no worker or WASM work. The first
 * explicit probe creates one persistent worker; successful results are reused.
 */
export class TextEngineClient {
  private worker: TextEngineWorkerPort | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingProbe>();
  private capability: TextEngineCapability | null = null;
  private inFlight: Promise<TextEngineCapability> | null = null;

  constructor(private readonly workerFactory: TextEngineWorkerFactory = createBrowserWorker) {}

  probe(): Promise<TextEngineCapability> {
    if (this.capability) return Promise.resolve(this.capability);
    if (this.inFlight) return this.inFlight;

    let worker: TextEngineWorkerPort;
    try {
      worker = this.ensureWorker();
    } catch (reason) {
      return Promise.reject(reason instanceof Error
        ? reason
        : new Error('The text engine worker could not start.'));
    }
    const requestId = ++this.requestId;
    const request: TextEngineWorkerRequest = {
      kind: 'probe',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId
    };
    let trackedPromise: Promise<TextEngineCapability>;
    trackedPromise = new Promise<TextEngineCapability>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage(request);
    }).then((capability) => {
      this.capability = capability;
      return capability;
    }).finally(() => {
      if (this.inFlight === trackedPromise) this.inFlight = null;
    });
    this.inFlight = trackedPromise;
    return trackedPromise;
  }

  dispose() {
    this.resetWorker(new Error('Text engine probing was canceled.'));
    this.capability = null;
    this.inFlight = null;
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.protocolVersion !== TEXT_ENGINE_PROTOCOL_VERSION) {
        pending.reject(new Error(`Unsupported text engine protocol ${data.protocolVersion}.`));
        this.resetWorker(new Error('The text engine protocol changed during initialization.'));
        return;
      }
      if (data.kind === 'error') {
        pending.reject(new Error(data.message));
        this.resetWorker(new Error(data.message));
        return;
      }
      pending.resolve({
        engineVersion: data.engineVersion,
        loadDurationMs: data.loadDurationMs
      });
    };
    worker.onerror = (event) => {
      this.resetWorker(new Error(event.message || 'The text engine worker failed.'));
    };
    worker.onmessageerror = () => {
      this.resetWorker(new Error('The text engine worker returned an unreadable response.'));
    };
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error) {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }
}

export const lightTableTextEngine = new TextEngineClient();
