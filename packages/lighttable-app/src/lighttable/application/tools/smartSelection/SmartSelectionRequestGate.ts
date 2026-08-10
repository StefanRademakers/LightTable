import type {
  PreparedSmartSelectionSource,
  SmartSelectionBackend,
  SmartSelectionCandidate,
  SmartSelectionRequestOptions,
  SmartSelectionSource
} from './SmartSelectionBackend';
import type { SelectionPoint } from '../../../editor/selection/selectionTypes';

/** Discards stale async inference without coupling the backend to editor state. */
export class SmartSelectionRequestGate {
  private generation = 0;
  private prepared: PreparedSmartSelectionSource | null = null;

  constructor(private readonly backend: SmartSelectionBackend) {}

  async prepare(source: SmartSelectionSource): Promise<PreparedSmartSelectionSource | null> {
    if (this.prepared?.sourceKey === source.key
      && this.prepared.documentRevision === source.documentRevision) return this.prepared;
    const generation = ++this.generation;
    const prepared = await this.backend.prepare(source);
    if (generation !== this.generation) {
      this.backend.disposePreparedSource(prepared);
      return null;
    }
    if (this.prepared && this.prepared.id !== prepared.id) {
      this.backend.disposePreparedSource(this.prepared);
    }
    this.prepared = prepared;
    return prepared;
  }

  async point(
    source: PreparedSmartSelectionSource,
    point: SelectionPoint,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[] | null> {
    const generation = ++this.generation;
    const candidates = await this.backend.selectPoint(source, point, options);
    return generation === this.generation && this.prepared?.id === source.id ? candidates : null;
  }

  async box(
    source: PreparedSmartSelectionSource,
    bounds: { x: number; y: number; width: number; height: number },
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[] | null> {
    const generation = ++this.generation;
    const candidates = await this.backend.selectBox(source, bounds, options);
    return generation === this.generation && this.prepared?.id === source.id ? candidates : null;
  }

  async subject(
    source: PreparedSmartSelectionSource,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[] | null> {
    if (!this.backend.selectSubject) return null;
    const generation = ++this.generation;
    const candidates = await this.backend.selectSubject(source, options);
    return generation === this.generation && this.prepared?.id === source.id ? candidates : null;
  }

  invalidate() {
    this.generation += 1;
    if (this.prepared) this.backend.disposePreparedSource(this.prepared);
    this.prepared = null;
  }

  dispose() {
    this.invalidate();
    this.backend.dispose();
  }
}
