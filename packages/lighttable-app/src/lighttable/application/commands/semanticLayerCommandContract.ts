import { BLEND_MODES, type BlendMode } from '../../editor/document/blendModes';
import type { LayerId, LayerLocks } from '../../editor/document/documentTypes';

export type SemanticLayerCommand =
  | { readonly kind: 'duplicate'; readonly layerId: LayerId }
  | { readonly kind: 'delete'; readonly layerIds: readonly LayerId[] }
  | { readonly kind: 'move'; readonly layerId: LayerId; readonly direction: 'up' | 'down' }
  | { readonly kind: 'set-blend-mode'; readonly layerId: LayerId; readonly blendMode: BlendMode }
  | { readonly kind: 'set-clipping'; readonly layerId: LayerId; readonly clipping: boolean }
  | { readonly kind: 'set-lock'; readonly layerIds: readonly LayerId[];
    readonly lock: keyof LayerLocks; readonly locked: boolean };

const blendModes = new Set<string>(BLEND_MODES.map(({ id }) => id));
const lockKinds = new Set<keyof LayerLocks>(['transparency', 'pixels', 'position', 'all']);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const layerId = (value: unknown): LayerId | null => (
  typeof value === 'string' && value.length > 0 && value.length <= 256
    ? value as LayerId
    : null
);

const layerIds = (value: unknown): readonly LayerId[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) return null;
  const parsed = value.map(layerId);
  return parsed.some((id) => id === null)
    ? null
    : [...new Set(parsed as LayerId[])];
};

export const parseSemanticLayerCommand = (
  kind: SemanticLayerCommand['kind'],
  value: unknown
): SemanticLayerCommand | { readonly message: string } => {
  if (!record(value)) return { message: 'Layer command parameters must be an object.' };
  if (kind === 'duplicate') {
    const target = layerId(value.layerId);
    return target ? { kind, layerId: target } : { message: 'Layer duplicate requires layerId.' };
  }
  if (kind === 'delete') {
    const targets = layerIds(value.layerIds);
    return targets ? { kind, layerIds: targets } : { message: 'Layer delete requires 1-256 layerIds.' };
  }
  if (kind === 'move') {
    const target = layerId(value.layerId);
    if (!target || (value.direction !== 'up' && value.direction !== 'down')) {
      return { message: 'Layer move requires layerId and direction up or down.' };
    }
    return { kind, layerId: target, direction: value.direction };
  }
  if (kind === 'set-blend-mode') {
    const target = layerId(value.layerId);
    if (!target || typeof value.blendMode !== 'string' || !blendModes.has(value.blendMode)) {
      return { message: 'Layer blend mode requires layerId and a supported blendMode.' };
    }
    return { kind, layerId: target, blendMode: value.blendMode as BlendMode };
  }
  if (kind === 'set-clipping') {
    const target = layerId(value.layerId);
    if (!target || typeof value.clipping !== 'boolean') {
      return { message: 'Layer clipping requires layerId and a boolean clipping value.' };
    }
    return { kind, layerId: target, clipping: value.clipping };
  }
  const targets = layerIds(value.layerIds);
  if (!targets || typeof value.lock !== 'string' || !lockKinds.has(value.lock as keyof LayerLocks)
    || typeof value.locked !== 'boolean') {
    return { message: 'Layer lock requires 1-256 layerIds, a supported lock and boolean locked value.' };
  }
  return { kind, layerIds: targets, lock: value.lock as keyof LayerLocks, locked: value.locked };
};
