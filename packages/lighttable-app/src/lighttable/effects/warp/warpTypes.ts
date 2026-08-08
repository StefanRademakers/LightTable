import type { AdjustmentModuleInstance, AdjustmentStack } from '../../processing/adjustmentStack';

export const WARP_NODE_TYPE = 'lt.warp';

export type WarpBrushMode =
  | 'push'
  | 'twirl-cw'
  | 'twirl-ccw'
  | 'pinch'
  | 'bloat'
  | 'smooth'
  | 'reconstruct'
  | 'freeze'
  | 'thaw';

export type WarpBorderMode = 'transparent' | 'clamp' | 'mirror' | 'extend-edge';
export type WarpDebugView = 'result' | 'displacement';

export interface WarpInputSample {
  readonly positionPx: readonly [number, number];
  readonly deltaPx: readonly [number, number];
  readonly pressure: number;
  readonly tilt: readonly [number, number];
  readonly timeMs: number;
}

export interface WarpBrushSettingsSnapshot {
  readonly diameterPx: number;
  readonly strength: number;
  readonly hardness: number;
  readonly flow: number;
  readonly spacing: number;
  readonly smooth: number;
  readonly pressureSize: boolean;
  readonly pressureStrength: boolean;
}

/** Mutable editor preferences. The authored stroke keeps mode separately. */
export interface WarpToolSettings extends WarpBrushSettingsSnapshot {
  readonly mode: WarpBrushMode;
  /** Transient editor visualization; never copied into an authored stroke. */
  readonly debugView: WarpDebugView;
}

export interface WarpStroke {
  readonly id: string;
  readonly mode: WarpBrushMode;
  readonly settings: WarpBrushSettingsSnapshot;
  readonly samples: readonly WarpInputSample[];
  readonly startedAtMs: number;
  readonly durationMs: number;
}

export interface WarpNodeSettings {
  readonly version: 1;
  readonly opacity: number;
  readonly borderMode: WarpBorderMode;
  readonly topologyMode: 'artistic' | 'protected';
  readonly edgePinning: number;
  readonly maskLinkMode: 'linked' | 'unlinked';
  readonly strokes: readonly WarpStroke[];
}

export const createDefaultWarpNodeSettings = (): WarpNodeSettings => ({
  version: 1,
  opacity: 1,
  borderMode: 'transparent',
  topologyMode: 'artistic',
  edgePinning: 0,
  maskLinkMode: 'linked',
  strokes: []
});

export const createWarpModuleInstance = (
  id: string,
  settings: WarpNodeSettings = createDefaultWarpNodeSettings()
): AdjustmentModuleInstance => ({
  id,
  type: WARP_NODE_TYPE,
  enabled: true,
  revision: 0,
  settings: structuredClone(settings) as unknown as Record<string, unknown>
});

/**
 * Inserts Warp at the canonical source-geometry boundary. Existing authored
 * order is retained for all other nodes.
 */
export const addWarpNodeToStack = (
  stack: AdjustmentStack,
  instance: AdjustmentModuleInstance
): AdjustmentStack => {
  if (instance.type !== WARP_NODE_TYPE) {
    throw new Error(`Expected ${WARP_NODE_TYPE}, received ${instance.type}`);
  }
  return {
    ...structuredClone(stack),
    revision: stack.revision + 1,
    modules: [structuredClone(instance), ...stack.modules.map((node) => structuredClone(node))]
  };
};

export const readWarpNodeSettings = (
  instance: AdjustmentModuleInstance
): WarpNodeSettings => {
  if (instance.type !== WARP_NODE_TYPE) {
    throw new Error(`Expected ${WARP_NODE_TYPE}, received ${instance.type}`);
  }
  const settings = instance.settings as unknown as Partial<WarpNodeSettings>;
  if (settings.version !== 1 || !Array.isArray(settings.strokes)) {
    throw new Error(`Invalid ${WARP_NODE_TYPE} settings`);
  }
  return structuredClone(settings) as WarpNodeSettings;
};

export const findWarpModuleInstance = (
  stack: AdjustmentStack | null | undefined
): AdjustmentModuleInstance | null =>
  stack?.modules.find((instance) => instance.type === WARP_NODE_TYPE) ?? null;

/**
 * Removes the authored Warp recipe without disturbing the relative order or
 * identity of any other processing node in the stack.
 */
export const removeWarpNodeFromStack = (
  stack: AdjustmentStack
): AdjustmentStack => {
  if (!findWarpModuleInstance(stack)) return stack;
  return {
    ...structuredClone(stack),
    revision: stack.revision + 1,
    modules: stack.modules
      .filter((instance) => instance.type !== WARP_NODE_TYPE)
      .map((instance) => structuredClone(instance))
  };
};

export const setWarpNodeSettings = (
  stack: AdjustmentStack,
  settings: WarpNodeSettings
): AdjustmentStack => {
  let found = false;
  const modules = stack.modules.map((instance) => {
    if (instance.type !== WARP_NODE_TYPE) return structuredClone(instance);
    found = true;
    return {
      ...structuredClone(instance),
      enabled: true,
      revision: instance.revision + 1,
      settings: structuredClone(settings) as unknown as Record<string, unknown>
    };
  });
  if (!found) {
    throw new Error(`Stack ${stack.id} has no ${WARP_NODE_TYPE} node.`);
  }
  return {
    ...structuredClone(stack),
    revision: stack.revision + 1,
    modules
  };
};
