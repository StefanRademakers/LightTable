import type { AdjustmentModuleInstance, AdjustmentStack } from './adjustmentStack';

export const GAUSSIAN_BLUR_MODULE_TYPE = 'lt.gaussian-blur';
export const DEFAULT_GAUSSIAN_BLUR_RADIUS = 8;
export const MAX_GAUSSIAN_BLUR_RADIUS = 100;

export interface GaussianBlurSettings {
  readonly radius: number;
}

export const clampGaussianBlurRadius = (value: number): number =>
  Math.min(MAX_GAUSSIAN_BLUR_RADIUS, Math.max(0, Number.isFinite(value) ? value : 0));

export const createGaussianBlurStack = (
  radius = DEFAULT_GAUSSIAN_BLUR_RADIUS,
  createId: (kind: 'stack' | 'module') => string = (kind) =>
    `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
): AdjustmentStack => ({
  id: createId('stack'),
  revision: 0,
  modules: [{
    id: createId('module'),
    type: GAUSSIAN_BLUR_MODULE_TYPE,
    enabled: true,
    revision: 0,
    settings: { radius: clampGaussianBlurRadius(radius) }
  }]
});

export const gaussianBlurModule = (
  stack: AdjustmentStack | null | undefined
): AdjustmentModuleInstance | null =>
  stack?.modules.find(({ type }) => type === GAUSSIAN_BLUR_MODULE_TYPE) ?? null;

export const gaussianBlurSettings = (
  stack: AdjustmentStack | null | undefined
): GaussianBlurSettings | null => {
  const module = gaussianBlurModule(stack);
  if (!module) return null;
  return { radius: clampGaussianBlurRadius(Number(module.settings.radius)) };
};

export const setGaussianBlurRadius = (
  stack: AdjustmentStack,
  radius: number
): AdjustmentStack => {
  const nextRadius = clampGaussianBlurRadius(radius);
  let changed = false;
  const modules = stack.modules.map((module) => {
    if (module.type !== GAUSSIAN_BLUR_MODULE_TYPE
      || Number(module.settings.radius) === nextRadius) return module;
    changed = true;
    return {
      ...module,
      revision: module.revision + 1,
      settings: { ...module.settings, radius: nextRadius }
    };
  });
  return changed ? { ...stack, revision: stack.revision + 1, modules } : stack;
};
