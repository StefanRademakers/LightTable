import { cloneVectorPath } from '../model/clone';
import type { VectorPath } from '../model/types';

export interface PathMutationCommit {
  before: VectorPath;
  after: VectorPath;
}

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
    this.preview = cloneVectorPath(mutate(cloneVectorPath(this.before)));
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
