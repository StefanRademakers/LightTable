export interface GradeLookAdjustments {
  /** Embedded document asset id. Null is an exact bypass. */
  assetId: string | null;
  /** Creative mix in percent. Zero is an exact bypass. */
  strength: number;
}

export const createDefaultGradeLook = (): GradeLookAdjustments => ({
  assetId: null,
  strength: 100
});

export const cloneGradeLook = (value: GradeLookAdjustments): GradeLookAdjustments => ({
  assetId: value.assetId,
  strength: value.strength
});

export const gradeLookIsActive = (value: GradeLookAdjustments): boolean =>
  Boolean(value.assetId) && value.strength > 0.00001;
