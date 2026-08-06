import type { LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';

export type SemanticLayerStyleCommand =
  | { readonly kind: 'add'; readonly layerId: string; readonly effectKind: LayerStyleKind;
      readonly settings?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'update'; readonly layerId: string; readonly effectId: string;
      readonly settings: Readonly<Record<string, unknown>> }
  | { readonly kind: 'remove'; readonly layerId: string; readonly effectId: string }
  | { readonly kind: 'move'; readonly layerId: string; readonly effectId: string; readonly targetIndex: number }
  | { readonly kind: 'toggle'; readonly layerId: string; readonly effectId: string; readonly enabled: boolean };

const KINDS: readonly LayerStyleKind[] = ['drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow',
  'bevel-emboss', 'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke'];
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255;

const boundedSettings = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (!record(value)) return false;
  let count = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    count += 1;
    if (count > 2048 || depth > 12) return false;
    if (typeof candidate === 'number') return Number.isFinite(candidate);
    if (typeof candidate === 'string') return candidate.length <= 1024;
    if (candidate === null || typeof candidate === 'boolean' || candidate === undefined) return true;
    if (Array.isArray(candidate)) return candidate.length <= 64 && candidate.every((entry) => visit(entry, depth + 1));
    return record(candidate) && Object.keys(candidate).length <= 64
      && Object.values(candidate).every((entry) => visit(entry, depth + 1));
  };
  return visit(value, 0);
};

export const parseSemanticLayerStyleCommand = (
  kind: SemanticLayerStyleCommand['kind'], value: unknown
): SemanticLayerStyleCommand | { readonly message: string } => {
  if (!record(value) || !id(value.layerId)) return { message: 'Layer Style commands require a valid layerId.' };
  if (kind === 'add') {
    if (!KINDS.includes(value.effectKind as LayerStyleKind)
      || (value.settings !== undefined && !boundedSettings(value.settings))) {
      return { message: 'The Layer Style kind or settings are invalid.' };
    }
  } else if (!id(value.effectId)) return { message: 'The Layer Style effectId is invalid.' };
  else if (kind === 'update' && !boundedSettings(value.settings)) return { message: 'The Layer Style settings are invalid.' };
  else if (kind === 'move' && (!Number.isInteger(value.targetIndex) || Number(value.targetIndex) < 0 || Number(value.targetIndex) > 63)) {
    return { message: 'The Layer Style target index is invalid.' };
  } else if (kind === 'toggle' && typeof value.enabled !== 'boolean') return { message: 'Layer Style enabled must be boolean.' };
  return structuredClone({ ...value, kind }) as SemanticLayerStyleCommand;
};

/** Keeps identity/type immutable while allowing transport-safe canonical settings. */
export const mergeLayerStyleSettings = (
  effect: LayerStyleInstance, settings: Readonly<Record<string, unknown>> | undefined
): unknown => ({ ...structuredClone(effect), ...structuredClone(settings ?? {}), id: effect.id, kind: effect.kind });
