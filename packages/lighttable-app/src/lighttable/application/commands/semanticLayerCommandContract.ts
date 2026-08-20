import { BLEND_MODES, type BlendMode } from '../../editor/document/blendModes';
import type { LayerId, LayerLocks } from '../../editor/document/documentTypes';
import type { AffineMatrix } from '../../editor/geometry/affine';

export type SemanticLayerCommand =
  | { readonly kind: 'duplicate'; readonly layerId: LayerId }
  | { readonly kind: 'copy-to-new-layer'; readonly layerId: LayerId }
  | { readonly kind: 'delete'; readonly layerIds: readonly LayerId[] }
  | { readonly kind: 'move'; readonly layerId: LayerId; readonly direction: 'up' | 'down' }
  | { readonly kind: 'set-blend-mode'; readonly layerId: LayerId; readonly blendMode: BlendMode }
  | { readonly kind: 'set-clipping'; readonly layerId: LayerId; readonly clipping: boolean }
  | { readonly kind: 'set-transform'; readonly layerId: LayerId; readonly transform: AffineMatrix }
  | { readonly kind: 'set-mask'; readonly layerId: LayerId;
    readonly operation: 'add' | 'remove' | 'set-enabled' | 'set-linked';
    readonly source?: 'reveal-all' | 'selection'; readonly enabled?: boolean; readonly linked?: boolean }
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
  if (kind === 'duplicate' || kind === 'copy-to-new-layer') {
    const target = layerId(value.layerId);
    if (!target || Object.keys(value).some((key) => key !== 'layerId')) {
      return { message: `${kind === 'duplicate' ? 'Layer duplicate' : 'Layer via Copy'} requires only layerId.` };
    }
    return { kind, layerId: target };
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
  if (kind === 'set-transform') {
    const target = layerId(value.layerId);
    const transform = record(value.transform) ? value.transform : null;
    const keys = ['a', 'b', 'c', 'd', 'tx', 'ty'] as const;
    if (!target || !transform || keys.some((key) => typeof transform[key] !== 'number'
      || !Number.isFinite(transform[key]) || Math.abs(transform[key]) > 10_000_000)) {
      return { message: 'Layer transform requires layerId and a bounded finite affine matrix.' };
    }
    return { kind, layerId: target, transform: {
      a: transform.a as number, b: transform.b as number,
      c: transform.c as number, d: transform.d as number,
      tx: transform.tx as number, ty: transform.ty as number
    } };
  }
  if (kind === 'set-mask') {
    const target = layerId(value.layerId);
    const operation = value.operation;
    if (!target || (operation !== 'add' && operation !== 'remove'
      && operation !== 'set-enabled' && operation !== 'set-linked')) {
      return { message: 'Layer mask requires layerId and a supported operation.' };
    }
    if (operation === 'add') {
      if (value.source !== undefined && value.source !== 'reveal-all' && value.source !== 'selection') {
        return { message: 'Layer mask add source must be reveal-all or selection.' };
      }
      return { kind, layerId: target, operation, source: value.source ?? 'reveal-all' };
    }
    if (operation === 'set-enabled') {
      return typeof value.enabled === 'boolean'
        ? { kind, layerId: target, operation, enabled: value.enabled }
        : { message: 'Layer mask set-enabled requires a boolean enabled value.' };
    }
    if (operation === 'set-linked') {
      return typeof value.linked === 'boolean'
        ? { kind, layerId: target, operation, linked: value.linked }
        : { message: 'Layer mask set-linked requires a boolean linked value.' };
    }
    return { kind, layerId: target, operation };
  }
  const targets = layerIds(value.layerIds);
  if (!targets || typeof value.lock !== 'string' || !lockKinds.has(value.lock as keyof LayerLocks)
    || typeof value.locked !== 'boolean') {
    return { message: 'Layer lock requires 1-256 layerIds, a supported lock and boolean locked value.' };
  }
  return { kind, layerIds: targets, lock: value.lock as keyof LayerLocks, locked: value.locked };
};
