export interface HalationSettings {
  enabled: boolean;
  amount: number;
  radius: number;
  threshold: number;
  warmth: number;
}

export const DEFAULT_HALATION_SETTINGS: Readonly<HalationSettings> = Object.freeze({
  enabled: false,
  amount: 35,
  radius: 42,
  threshold: 72,
  warmth: 70
});

export const createDefaultHalationSettings = (): HalationSettings => ({ ...DEFAULT_HALATION_SETTINGS });
export const cloneHalationSettings = (settings: HalationSettings): HalationSettings => ({ ...settings });
export const halationIsActive = (settings: HalationSettings) => settings.enabled && settings.amount > 0.00001;
