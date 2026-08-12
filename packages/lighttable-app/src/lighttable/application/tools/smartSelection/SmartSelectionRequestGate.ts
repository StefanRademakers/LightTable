import type {
  PreparedSmartSelectionSource,
  SmartSelectionBackend,
  SmartSelectionCandidate,
  SmartSelectionPrompt,
  SmartSelectionRequestOptions,
  SmartSelectionSource
} from './SmartSelectionBackend';

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

  async prompt(
    source: PreparedSmartSelectionSource,
    prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[] | null> {
    const generation = ++this.generation;
    const candidates = await this.backend.selectPrompt(source, prompt, options);
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
