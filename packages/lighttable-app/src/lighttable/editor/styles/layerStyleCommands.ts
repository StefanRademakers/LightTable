import type { ImageDocument, LayerId, LayerNode } from '../document/documentTypes';
import { findLayerNode, updateLayerNode } from '../document/layerTree';
import { cloneLayerStyleStack } from './layerStyleDefaults';
import type {
  LayerStyleId,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack
} from './layerStyleTypes';
import { createDefaultLayerStyle } from './layerStyleDefaults';

const updateDocument = (
  document: ImageDocument,
  layerId: LayerId,
  updater: (stack: LayerStyleStack) => LayerStyleStack
) => {
  if (!findLayerNode(document.layers, layerId)) return document;
  const now = Date.now();
  let changed = false;
  const layers = updateLayerNode(document.layers, layerId, (layer): LayerNode => {
    const stack = updater(layer.styleStack);
    if (stack === layer.styleStack) return layer;
    changed = true;
    return {
      ...layer,
      styleStack: stack,
      revision: layer.revision + 1,
      modifiedAt: now
    };
  });
  return changed ? {
    ...document,
    layers,
    revision: document.revision + 1,
    modifiedAt: now
  } : document;
};

const replaceEffects = (
  stack: LayerStyleStack,
  effects: LayerStyleInstance[]
): LayerStyleStack => ({
  ...stack,
  effects,
  revision: stack.revision + 1
});

export const setLayerStyleStack = (
  document: ImageDocument,
  layerId: LayerId,
  styleStack: LayerStyleStack
) => updateDocument(document, layerId, (current) => {
  const next = cloneLayerStyleStack(styleStack);
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
});

export const setLayerStyleStackEnabled = (
  document: ImageDocument,
  layerId: LayerId,
  enabled: boolean
) => updateDocument(document, layerId, (stack) => stack.enabled === enabled ? stack : ({
  ...stack,
  enabled,
  revision: stack.revision + 1
}));

export const setLayerStyleScale = (
  document: ImageDocument,
  layerId: LayerId,
  scale: number
) => updateDocument(document, layerId, (stack) => {
  const next = Math.min(10, Math.max(0.01, scale));
  return stack.scale === next ? stack : {
    ...stack,
    scale: next,
    revision: stack.revision + 1
  };
});

export const setLayerStyleGlobalLight = (
  document: ImageDocument,
  layerId: LayerId,
  globalLight: LayerStyleStack['globalLight']
) => updateDocument(document, layerId, (stack) => (
  stack.globalLight.angle === globalLight.angle
  && stack.globalLight.altitude === globalLight.altitude
) ? stack : ({
  ...stack,
  globalLight: {
    angle: ((globalLight.angle % 360) + 360) % 360,
    altitude: Math.min(90, Math.max(0, globalLight.altitude))
  },
  revision: stack.revision + 1
}));

export const addLayerStyle = (
  document: ImageDocument,
  layerId: LayerId,
  kind: LayerStyleKind
) => updateDocument(document, layerId, (stack) =>
  replaceEffects(stack, [...stack.effects, createDefaultLayerStyle(kind)]));

export const removeLayerStyle = (
  document: ImageDocument,
  layerId: LayerId,
  effectId: LayerStyleId
) => updateDocument(document, layerId, (stack) => {
  const effects = stack.effects.filter((effect) => effect.id !== effectId);
  return effects.length === stack.effects.length ? stack : replaceEffects(stack, effects);
});

export const updateLayerStyle = (
  document: ImageDocument,
  layerId: LayerId,
  effectId: LayerStyleId,
  updater: (effect: LayerStyleInstance) => LayerStyleInstance
) => updateDocument(document, layerId, (stack) => {
  let changed = false;
  const effects = stack.effects.map((effect) => {
    if (effect.id !== effectId) return effect;
    const next = updater(structuredClone(effect));
    if (next.id !== effect.id || next.kind !== effect.kind) return effect;
    changed = JSON.stringify(effect) !== JSON.stringify(next);
    return changed ? next : effect;
  });
  return changed ? replaceEffects(stack, effects) : stack;
});

export const setLayerStyleEnabled = (
  document: ImageDocument,
  layerId: LayerId,
  effectId: LayerStyleId,
  enabled: boolean
) => updateLayerStyle(document, layerId, effectId, (effect) => ({
  ...effect,
  enabled
}));

export const moveLayerStyle = (
  document: ImageDocument,
  layerId: LayerId,
  effectId: LayerStyleId,
  targetIndex: number
) => updateDocument(document, layerId, (stack) => {
  const index = stack.effects.findIndex((effect) => effect.id === effectId);
  if (index < 0) return stack;
  const clamped = Math.min(stack.effects.length - 1, Math.max(0, targetIndex));
  if (index === clamped) return stack;
  const effects = [...stack.effects];
  const [effect] = effects.splice(index, 1);
  effects.splice(clamped, 0, effect);
  return replaceEffects(stack, effects);
});

export const clearLayerStyles = (
  document: ImageDocument,
  layerId: LayerId
) => updateDocument(document, layerId, (stack) =>
  stack.effects.length ? replaceEffects(stack, []) : stack);

export const copyLayerStyleStack = (
  document: ImageDocument,
  layerId: LayerId
) => {
  const layer = findLayerNode(document.layers, layerId)?.node;
  return layer ? cloneLayerStyleStack(layer.styleStack) : null;
};

export const pasteLayerStyleStack = (
  document: ImageDocument,
  layerId: LayerId,
  stack: LayerStyleStack
) => setLayerStyleStack(document, layerId, stack);
