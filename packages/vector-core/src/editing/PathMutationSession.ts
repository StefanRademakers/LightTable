import { cloneVectorPath } from '../model/clone';
import type { VectorPath } from '../model/types';

export interface PathMutationCommit {
  before: VectorPath;
  after: VectorPath;
}

const previewRevision = (
  opening: number,
  current: number,
  candidate: number
) => candidate === opening
  ? opening
  : Math.max(candidate, current + 1);

/**
 * One pointer gesture owns one session. Preview updates always derive from the
 * opening snapshot; commit publishes at most one reversible mutation.
 */
export class PathMutationSession {
  private readonly before: VectorPath;
  private preview: VectorPath;
  private finished = false;

  constructor(path: VectorPath) {
    this.before = cloneVectorPath(path);
    this.preview = cloneVectorPath(path);
  }

  update(mutate: (openingSnapshot: VectorPath) => VectorPath) {
    this.assertOpen();
    const candidate = cloneVectorPath(mutate(cloneVectorPath(this.before)));
    // Preview functions intentionally derive geometry from the immutable
    // opening snapshot so pointer deltas never accumulate. Their ordinary
    // `opening + 1` revision is therefore identical for every drag sample.
    // Promote changed preview revisions monotonically so GPU geometry/style
    // caches cannot retain the first sample until another edit occurs.
    candidate.geometryRevision = previewRevision(
      this.before.geometryRevision,
      this.preview.geometryRevision,
      candidate.geometryRevision
    );
    candidate.transformRevision = previewRevision(
      this.before.transformRevision,
      this.preview.transformRevision,
      candidate.transformRevision
    );
    candidate.styleRevision = previewRevision(
      this.before.styleRevision,
      this.preview.styleRevision,
      candidate.styleRevision
    );
    this.preview = candidate;
    return this.current();
  }

  current() {
    return cloneVectorPath(this.preview);
  }

  cancel() {
    this.assertOpen();
    this.finished = true;
    return cloneVectorPath(this.before);
  }

  commit(): PathMutationCommit | null {
    this.assertOpen();
    this.finished = true;
    if (this.preview.geometryRevision === this.before.geometryRevision
      && this.preview.transformRevision === this.before.transformRevision
      && this.preview.styleRevision === this.before.styleRevision) return null;
    return {
      before: cloneVectorPath(this.before),
      after: cloneVectorPath(this.preview)
    };
  }

  private assertOpen() {
    if (this.finished) throw new Error('Path mutation session is already finished.');
  }
}
