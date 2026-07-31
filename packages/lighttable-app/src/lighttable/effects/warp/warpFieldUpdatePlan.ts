export type WarpFieldUpdateKind = 'none' | 'append' | 'rebuild';

export interface WarpFieldUpdatePlan {
  readonly kind: WarpFieldUpdateKind;
  readonly upload: Float32Array;
}

const equalPackedValues = (
  left: Float32Array,
  right: Float32Array,
  length: number
): boolean => {
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

/**
 * Plans the cheapest correct update from the field currently committed on the
 * GPU to the newly authored Warp recipe.
 *
 * Warp stamps are append-only while a gesture is active. That makes it
 * possible to compose only the suffix into the persistent inverse-coordinate
 * field. Undo, reset, changed history and document restore deliberately take
 * the rebuild path.
 */
export const planWarpFieldUpdate = (
  committed: Float32Array,
  desired: Float32Array
): WarpFieldUpdatePlan => {
  if (
    committed.length === desired.length &&
    equalPackedValues(committed, desired, desired.length)
  ) {
    return { kind: 'none', upload: new Float32Array() };
  }

  if (
    committed.length > 0 &&
    desired.length > committed.length &&
    equalPackedValues(committed, desired, committed.length)
  ) {
    return {
      kind: 'append',
      upload: desired.slice(committed.length)
    };
  }

  return {
    kind: 'rebuild',
    upload: desired.slice()
  };
};
