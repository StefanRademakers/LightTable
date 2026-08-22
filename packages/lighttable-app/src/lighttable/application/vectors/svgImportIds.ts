export type SvgImportIdKind = 'element' | 'subpath' | 'anchor';

/**
 * One cryptographically unique namespace per import keeps independently
 * placed SVGs collision-free. IDs inside that namespace are cheap monotonic
 * counters; generating a UUID for every anchor is needlessly expensive on
 * path-heavy artwork and adds no uniqueness.
 */
export const createSvgImportIdFactory = (
  namespace: string = globalThis.crypto.randomUUID()
) => {
  let sequence = 0;
  return (kind: SvgImportIdKind) => `svg-${kind}-${namespace}-${++sequence}`;
};
