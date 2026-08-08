import { DEFAULT_BRUSH_TIP, type BrushTipDefinition } from './strokeBuilder';

export const BRUSH_PRESET_IDS = [
  'round',
  'airbrush',
  'ink-pen',
  'calligraphy',
  'rough-ink',
  'liquify'
] as const;

export type BrushPresetId = typeof BRUSH_PRESET_IDS[number];

export interface BrushPresetDefinition {
  readonly id: BrushPresetId;
  readonly name: string;
  readonly category: 'Basic' | 'Effects';
  readonly engine: 'paint' | 'warp';
  readonly tip: BrushTipDefinition;
  readonly defaults: {
    readonly hardness: number;
    readonly opacity: number;
    readonly flow: number;
    readonly spacing: number;
    readonly smooth: number;
  };
}

export const BRUSH_PRESETS: readonly BrushPresetDefinition[] = [
  {
    id: 'round', name: 'Round', category: 'Basic',
    engine: 'paint',
    tip: DEFAULT_BRUSH_TIP,
    defaults: { hardness: 0.75, opacity: 1, flow: 0.35, spacing: 0.05, smooth: 0 }
  },
  {
    id: 'airbrush', name: 'Airbrush', category: 'Basic',
    engine: 'paint',
    tip: { roundness: 1, angleDegrees: 0, roughness: 0 },
    defaults: { hardness: 0, opacity: 1, flow: 0.12, spacing: 0.04, smooth: 0.15 }
  },
  {
    id: 'ink-pen', name: 'Ink Pen', category: 'Basic',
    engine: 'paint',
    tip: { roundness: 1, angleDegrees: 0, roughness: 0 },
    defaults: { hardness: 0.95, opacity: 1, flow: 1, spacing: 0.04, smooth: 0.6 }
  },
  {
    id: 'calligraphy', name: 'Calligraphy', category: 'Basic',
    engine: 'paint',
    tip: { roundness: 0.2, angleDegrees: 45, roughness: 0 },
    defaults: { hardness: 0.9, opacity: 1, flow: 0.8, spacing: 0.04, smooth: 0.6 }
  },
  {
    id: 'rough-ink', name: 'Rough Ink', category: 'Basic',
    engine: 'paint',
    tip: { roundness: 1, angleDegrees: 0, roughness: 0.18 },
    defaults: { hardness: 0.9, opacity: 1, flow: 0.75, spacing: 0.035, smooth: 0.55 }
  },
  {
    id: 'liquify', name: 'Liquify', category: 'Effects',
    engine: 'warp',
    tip: DEFAULT_BRUSH_TIP,
    defaults: { hardness: 0.5, opacity: 0.5, flow: 0.5, spacing: 0.1, smooth: 0.5 }
  }
];

const presetById = new Map(BRUSH_PRESETS.map((preset) => [preset.id, preset]));

export const resolveBrushPreset = (id: BrushPresetId | string): BrushPresetDefinition =>
  presetById.get(id as BrushPresetId) ?? BRUSH_PRESETS[0]!;

export const brushPresetChange = (id: BrushPresetId) => {
  const preset = resolveBrushPreset(id);
  return { presetId: preset.id, ...preset.defaults };
};
