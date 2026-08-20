import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { cloneLayerStyleStack, createDefaultLayerStyle } from '../../editor/styles/layerStyleDefaults';
import { setLayerStyleStack } from '../../editor/styles/layerStyleCommands';
import { parseLayerStyleInstance } from '../../editor/styles/layerStyleValidation';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import { layerStyleSettingsMatchKind, mergeLayerStyleSettings,
  type SemanticLayerStyleCommand } from '../commands/semanticLayerStyleCommandContract';

export interface SemanticLayerStyleCommandDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

type StackCommand = Extract<SemanticLayerStyleCommand, { readonly kind: 'stack-update' }>;
type EffectCommand = Exclude<SemanticLayerStyleCommand, StackCommand>;
type StackResult = { readonly layerId: LayerId; readonly settings: Readonly<Record<string, unknown>> };
type EffectResult = { readonly layerId: LayerId; readonly effectId: LayerStyleId };

export function executeSemanticLayerStyleCommand(
  command: StackCommand, dependencies: SemanticLayerStyleCommandDependencies
): StackResult | null;
export function executeSemanticLayerStyleCommand(
  command: EffectCommand, dependencies: SemanticLayerStyleCommandDependencies
): EffectResult | null;
export function executeSemanticLayerStyleCommand(
  command: SemanticLayerStyleCommand, dependencies: SemanticLayerStyleCommandDependencies
): StackResult | EffectResult | null;
export function executeSemanticLayerStyleCommand(
  command: SemanticLayerStyleCommand, dependencies: SemanticLayerStyleCommandDependencies
): StackResult | EffectResult | null {
  const before = dependencies.getDocument();
  const layer = before ? findDocumentLayer(before, command.layerId as LayerId) : null;
  if (!before || !layer || !layerSupportsLayerStyles(layer)) throw new Error('The layer cannot own Layer Styles.');
  const stack = cloneLayerStyleStack(layer.styleStack);
  if (command.kind === 'stack-update') {
    if (command.settings.scale !== undefined) stack.scale = command.settings.scale;
    if (command.settings.globalLight !== undefined) {
      stack.globalLight = { ...command.settings.globalLight };
    }
    stack.revision += 1;
    const after = setLayerStyleStack(before, layer.id, stack);
    if (after === before) return null;
    dependencies.applyDocument(after);
    dependencies.recordHistory(before, after);
    return { layerId: layer.id, settings: structuredClone(command.settings) };
  }
  let effectId: LayerStyleId;
  if (command.kind === 'add') {
    if (stack.effects.length >= 64) throw new Error('A layer may contain at most 64 effects.');
    if (!layerStyleSettingsMatchKind(command.effectKind, command.settings)) {
      throw new Error('The Layer Style settings do not apply to this effect kind.');
    }
    const base = createDefaultLayerStyle(command.effectKind);
    const effect = parseLayerStyleInstance(mergeLayerStyleSettings(base, command.settings));
    stack.effects.push(effect); effectId = effect.id;
  } else {
    const index = stack.effects.findIndex(({ id }) => id === command.effectId);
    if (index < 0) throw new Error('The Layer Style effect no longer exists.');
    effectId = stack.effects[index].id;
    if (command.kind === 'remove') stack.effects.splice(index, 1);
    else if (command.kind === 'move') {
      const [effect] = stack.effects.splice(index, 1);
      stack.effects.splice(Math.min(stack.effects.length, command.targetIndex), 0, effect);
    } else if (command.kind === 'toggle') stack.effects[index] = { ...stack.effects[index], enabled: command.enabled };
    else {
      if (!layerStyleSettingsMatchKind(stack.effects[index].kind, command.settings)) {
        throw new Error('The Layer Style settings do not apply to the target effect kind.');
      }
      stack.effects[index] = parseLayerStyleInstance(
        mergeLayerStyleSettings(stack.effects[index], command.settings)
      );
    }
  }
  stack.revision += 1;
  const after = setLayerStyleStack(before, layer.id, stack);
  if (after === before) return null;
  dependencies.applyDocument(after);
  dependencies.recordHistory(before, after);
  return { layerId: layer.id, effectId };
}
