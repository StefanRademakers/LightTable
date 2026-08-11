export type ToneBrushToolId = 'dodge' | 'burn' | 'sponge';
export type ToneBrushRange = 'shadows' | 'midtones' | 'highlights';
export type SpongeBrushMode = 'saturate' | 'desaturate';

export interface ToneBrushSettings {
  readonly range: ToneBrushRange;
  readonly exposure: number;
  readonly protectTones: boolean;
  readonly spongeMode: SpongeBrushMode;
  readonly spongeFlow: number;
  readonly vibrance: boolean;
}

export interface ToneBrushStrokePlan {
  readonly operator: 'tone';
  readonly mode: ToneBrushToolId;
  readonly range: ToneBrushRange;
  readonly spongeMode: SpongeBrushMode;
  readonly protectTones: boolean;
  readonly vibrance: boolean;
}

export const isToneBrushTool = (tool: string): tool is ToneBrushToolId =>
  tool === 'dodge' || tool === 'burn' || tool === 'sponge';

/**
 * Photoshop's Exposure control stops scaling linearly above roughly 20%.
 * Black-box ramp captures at 5/20/50% show a stronger high-end compression for
 * Dodge than Burn. Keep this in the shared tone contract so UI, pressure and
 * GPU submission cannot acquire separate interpretations of Exposure.
 */
export const calibratedToneExposure = (
  tool: Extract<ToneBrushToolId, 'dodge' | 'burn'>,
  exposure: number,
  protectTones: boolean
): number => {
  const bounded = Math.max(0, Math.min(1, exposure));
  const base = bounded <= 0.2
    ? bounded
    : 0.2 + (bounded - 0.2) * (tool === 'dodge' ? 2 / 3 : 1);
  // The face-corpus accumulation oracle shows that Photoshop's legacy mode
  // builds faster while Protect Tones deliberately accumulates more slowly.
  // This distinction is small on the first dab but material after 10–20 passes.
  return Math.min(1, base * (protectTones ? 0.35 : 0.7));
};

export const createDefaultToneBrushSettings = (): ToneBrushSettings => ({
  range: 'midtones',
  exposure: 0.15,
  protectTones: true,
  spongeMode: 'saturate',
  spongeFlow: 0.5,
  vibrance: true
});
