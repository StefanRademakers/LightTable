import type { InputAnimationFrameHost } from '../input/latestFrameValueScheduler';
import { LatestFrameValueScheduler } from '../input/latestFrameValueScheduler';
import {
  DEFAULT_SCOPE_SETTINGS,
  DEFAULT_SCOPE_VISIBILITY,
  type ScopeSettings,
  type ScopeVisibility
} from '../../scopes';
import type { RgbHistogram } from '../../types';

export interface DocumentScopesSnapshot {
  readonly settings: ScopeSettings;
  readonly visibility: ScopeVisibility;
  readonly histogram: RgbHistogram | null;
  readonly error: string | null;
}

type Listener = () => void;

/**
 * Owns the low-frequency UI projection for one mounted document's scopes.
 * GPU resources remain renderer-owned; lifecycle code reads this owner
 * synchronously instead of consulting duplicate React state and mutable refs.
 */
export class DocumentScopesPresentation {
  private snapshot: DocumentScopesSnapshot = {
    settings: { ...DEFAULT_SCOPE_SETTINGS },
    visibility: { ...DEFAULT_SCOPE_VISIBILITY },
    histogram: null,
    error: null
  };
  private readonly listeners = new Set<Listener>();
  private readonly histogramPublication: LatestFrameValueScheduler<RgbHistogram>;

  constructor(frameHost?: InputAnimationFrameHost) {
    this.histogramPublication = new LatestFrameValueScheduler(
      histogram => this.publish({ ...this.snapshot, histogram }),
      frameHost
    );
  }

  readonly getSnapshot = (): DocumentScopesSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly publishHistogram = (histogram: RgbHistogram): void => {
    this.histogramPublication.schedule(histogram);
  };

  readonly resetHistogram = (): void => {
    this.histogramPublication.cancel();
    if (this.snapshot.histogram !== null) {
      this.publish({ ...this.snapshot, histogram: null });
    }
  };

  readonly setSettings = (settings: ScopeSettings): void => {
    this.publish({ ...this.snapshot, settings });
  };

  readonly setVisibility = (scope: keyof ScopeVisibility, visible: boolean): void => {
    if (this.snapshot.visibility[scope] === visible) return;
    this.publish({
      ...this.snapshot,
      visibility: { ...this.snapshot.visibility, [scope]: visible }
    });
  };

  readonly setError = (error: string | null): void => {
    if (this.snapshot.error === error) return;
    this.publish({ ...this.snapshot, error });
  };

  readonly reset = (settings: ScopeSettings, visibility: ScopeVisibility): void => {
    this.histogramPublication.cancel();
    this.publish({ settings, visibility, histogram: null, error: null });
  };

  /** Cancels host work without retiring the reusable React-owned instance. */
  disconnect(): void {
    this.histogramPublication.cancel();
  }

  private publish(snapshot: DocumentScopesSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }
}
