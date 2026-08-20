import type { LightTableCommandId } from '../commands/lightTableCommandContract';
import type { LayerStyleId, LayerStyleInstance, LayerStyleStack } from '../../editor/styles/layerStyleTypes';

export interface ObservedLayerStyleCommand {
  readonly command: LightTableCommandId;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const effectSettings = (effect: LayerStyleInstance, includeEnabled: boolean) => {
  const { id: _id, kind: _kind, enabled, ...settings } = structuredClone(effect);
  return includeEnabled ? { ...settings, enabled } : settings;
};

const changedEffectSettings = (before: LayerStyleInstance, after: LayerStyleInstance) => {
  const previous = effectSettings(before, false) as Record<string, unknown>;
  const current = effectSettings(after, false) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => !equal(previous[key], value)));
};

/**
 * Projects one already-committed local Layer Style checkpoint into replayable
 * semantic operations. Interactive previews never enter this boundary.
 */
export const observedLayerStyleCommands = (
  layerId: string,
  before: LayerStyleStack,
  after: LayerStyleStack
): readonly ObservedLayerStyleCommand[] => {
  const commands: ObservedLayerStyleCommand[] = [];
  const previous = new Map(before.effects.map((effect) => [effect.id, effect]));
  const current = new Map(after.effects.map((effect) => [effect.id, effect]));

  if (before.enabled !== after.enabled) commands.push({
    command: 'layer.style.setEnabled', parameters: { layerId, enabled: after.enabled },
    result: { layerId, enabled: after.enabled }
  });
  const stackSettings = {
    ...(before.scale === after.scale ? {} : { scale: after.scale }),
    ...(equal(before.globalLight, after.globalLight) ? {} : { globalLight: structuredClone(after.globalLight) })
  };
  if (Object.keys(stackSettings).length > 0) commands.push({
    command: 'layer.style.update', parameters: { layerId, settings: stackSettings },
    result: { layerId, settings: stackSettings }
  });

  for (const effect of before.effects) {
    if (!current.has(effect.id)) commands.push({
      command: 'layer.effect.remove', parameters: { layerId, effectId: effect.id },
      result: { layerId, effectId: effect.id }
    });
  }
  for (const effect of after.effects) {
    if (!previous.has(effect.id)) commands.push({
      command: 'layer.effect.add', parameters: {
        layerId, effectKind: effect.kind, settings: effectSettings(effect, true)
      },
      result: { layerId, effectId: effect.id }
    });
  }
  for (const effect of after.effects) {
    const old = previous.get(effect.id);
    if (!old || old.kind !== effect.kind) continue;
    if (old.enabled !== effect.enabled) commands.push({
      command: 'layer.effect.setEnabled',
      parameters: { layerId, effectId: effect.id, enabled: effect.enabled },
      result: { layerId, effectId: effect.id, enabled: effect.enabled }
    });
    const settings = changedEffectSettings(old, effect);
    if (Object.keys(settings).length > 0) commands.push({
      command: 'layer.effect.update', parameters: { layerId, effectId: effect.id, settings },
      result: { layerId, effectId: effect.id }
    });
  }

  const order = before.effects.map(({ id }) => id).filter((id) => current.has(id));
  for (const effect of after.effects) if (!previous.has(effect.id)) order.push(effect.id);
  after.effects.forEach((effect, targetIndex) => {
    const currentIndex = order.indexOf(effect.id);
    if (currentIndex < 0 || currentIndex === targetIndex) return;
    order.splice(currentIndex, 1);
    order.splice(targetIndex, 0, effect.id);
    commands.push({
      command: 'layer.effect.move', parameters: { layerId, effectId: effect.id, targetIndex },
      result: { layerId, effectId: effect.id }
    });
  });
  return commands;
};
