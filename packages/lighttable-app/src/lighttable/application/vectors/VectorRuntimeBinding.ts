export interface VectorRuntimeScope { isCurrent(): boolean }

/** Revision-independent lifetime: normal previews may replace document objects. */
export class VectorRuntimeBinding {
  private documentId: string | null;
  private scope: VectorRuntimeScope;
  constructor(private readonly getDocumentId: () => string | null,
    private readonly capture: () => VectorRuntimeScope) {
    this.documentId = getDocumentId();
    this.scope = capture();
  }
  synchronize(retire: () => void) {
    const id = this.getDocumentId();
    if (id === this.documentId && this.scope.isCurrent()) return id !== null;
    retire();
    this.documentId = id;
    this.scope = this.capture();
    return id !== null;
  }
}
