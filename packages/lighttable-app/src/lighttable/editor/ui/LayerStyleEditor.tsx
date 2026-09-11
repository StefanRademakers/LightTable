import { IconButton, MaskIcon,
  PanelSectionHeader, Button } from '@lighttable/ui';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { Select } from '@lighttable/ui';
import { EffectPanel } from '../../effects/EffectPanel';
import {
  createDefaultLayerStyle,
  layerStyleKindLabels
} from '../styles/layerStyleDefaults';
import type {
  LayerStyleId,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack
} from '../styles/layerStyleTypes';
import type { LayerStyleInteractionAdmission } from '../../application/styles/useLayerStyleEditorController';
import { useLayerStyleDraftInteraction } from '../../application/styles/useLayerStyleDraftInteraction';
import {
  LayerStyleInteractionContext,
  SwitchControl
} from './LayerStyleInteractionControls';
import { EffectControls } from './LayerStyleEffectControls';

interface LayerStyleEditorProps {
  initialStack: LayerStyleStack;
  initialEffectId?: LayerStyleId;
  previewIntervalMs?: number;
  onPreview: (stack: LayerStyleStack, admission: LayerStyleInteractionAdmission) => void;
  onInteractionStart?: () => LayerStyleInteractionAdmission;
  onInteractionCommit?: (admission: LayerStyleInteractionAdmission) => void;
  onInteractionCancel?: (admission: LayerStyleInteractionAdmission) => void;
}

const STYLE_KINDS = Object.keys(layerStyleKindLabels) as LayerStyleKind[];

// Style controls update their local UI at native input speed. Publishing a
// complete document/style snapshot faster than an interactive render frame
// only creates React and GPU invalidation backlog. Simple documents keep the
// normal 30 Hz contract; the panel can select a slower newest-only cadence for
// complex documents. Pointer-up still flushes the exact final value.
export const LAYER_STYLE_PREVIEW_INTERVAL_MS = 33;

export const LayerStyleEditor: React.FC<LayerStyleEditorProps> = ({
  initialStack,
  initialEffectId,
  previewIntervalMs = LAYER_STYLE_PREVIEW_INTERVAL_MS,
  onPreview,
  onInteractionStart,
  onInteractionCommit,
  onInteractionCancel
}) => {
  const { draft, interactionCallbacks, performDiscreteEdit, updateDraft } =
    useLayerStyleDraftInteraction({
      initialStack,
      previewIntervalMs,
      onPreview,
      onInteractionStart,
      onInteractionCommit,
      onInteractionCancel
    });
  const [expandedIds, setExpandedIds] = React.useState<Set<LayerStyleId>>(() => {
    const first = initialEffectId ?? initialStack.effects.at(-1)?.id;
    return new Set(first ? [first] : []);
  });
  const [newKind, setNewKind] = React.useState<LayerStyleKind>('drop-shadow');

  React.useEffect(() => {
    if (initialEffectId && draft.effects.some((effect) => effect.id === initialEffectId)) {
      setExpandedIds((current) => new Set(current).add(initialEffectId));
    }
  // The requested row changes only when the Layers panel opens a specific
  // effect. Draft edits must not force selection back to that row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEffectId]);

  const patchEffect = (effectId: LayerStyleId, patch: Partial<LayerStyleInstance>) => {
    updateDraft((current) => ({
      ...current,
      effects: current.effects.map((effect) =>
        effect.id === effectId ? { ...effect, ...patch } as LayerStyleInstance : effect
      ),
      revision: current.revision + 1
    }));
  };
  const resetEffect = (effectId: LayerStyleId) => {
    updateDraft((current) => ({
      ...current,
      effects: current.effects.map((effect) => {
        if (effect.id !== effectId) return effect;
        return {
          ...createDefaultLayerStyle(effect.kind),
          id: effect.id,
          name: effect.name,
          enabled: effect.enabled
        } as LayerStyleInstance;
      }),
      revision: current.revision + 1
    }));
  };

  const resetAllEffects = () => {
    updateDraft((current) => ({
      ...current,
      scale: 1,
      effects: current.effects.map((effect) => ({
        ...createDefaultLayerStyle(effect.kind),
        id: effect.id,
        name: effect.name,
        enabled: effect.enabled
      } as LayerStyleInstance)),
      revision: current.revision + 1
    }));
  };

  const addStyle = () => {
    const effect = createDefaultLayerStyle(newKind);
    updateDraft((current) => ({
      ...current,
      enabled: true,
      effects: [...current.effects, effect],
      revision: current.revision + 1
    }));
    setExpandedIds((current) => new Set(current).add(effect.id));
  };

  const removeEffect = (effectId: LayerStyleId) => {
    if (!draft.effects.some((effect) => effect.id === effectId)) return;
    updateDraft((current) => ({
      ...current,
      effects: current.effects.filter((effect) => effect.id !== effectId),
      revision: current.revision + 1
    }));
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(effectId);
      return next;
    });
  };

  return (
      <LayerStyleInteractionContext.Provider value={interactionCallbacks}>
      <div
        className="lighttable-style-editor lighttable-style-editor--panel lighttable-style-editor--groups"
        role="region"
        aria-label="Layer Style"
      >
        <section className="lighttable-group lighttable-master-group">
          <PanelSectionHeader label="All" actions={<>
              <IconButton variant="quiet" type="button"
                onClick={() => performDiscreteEdit(resetAllEffects)}
                aria-label="Reset all layer effects" title="Reset all layer effects"
                icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
              <SwitchControl
                checked={draft.enabled}
                onCheckedChange={(enabled) => updateDraft((current) => ({
                  ...current,
                  enabled,
                  revision: current.revision + 1
                }))}
                label={`${draft.enabled ? 'Disable' : 'Enable'} all layer effects`}
              />
            </>} />
        </section>
        <div className="lighttable-panel__controls lighttable-style-editor__groups">
          {[...draft.effects].reverse().map((effect) => (
            <EffectPanel
              key={effect.id}
              label={effect.name}
              expanded={expandedIds.has(effect.id)}
              enabled={effect.enabled}
              resetModifierActive={false}
              onExpandedChange={(expanded) => setExpandedIds((current) => {
                const next = new Set(current);
                if (expanded) next.add(effect.id);
                else next.delete(effect.id);
                return next;
              })}
              onEnabledChange={(enabled) => performDiscreteEdit(() => patchEffect(effect.id, { enabled }))}
              onReset={() => performDiscreteEdit(() => resetEffect(effect.id))}
              onRemove={() => performDiscreteEdit(() => removeEffect(effect.id))}
            >
              <EffectControls
                effect={effect}
                patch={(patch) => patchEffect(effect.id, patch)}
              />
            </EffectPanel>
          ))}
          <div className="lighttable-style-editor__add">
            <Select value={newKind} onValueChange={(nextValue) => setNewKind(nextValue as LayerStyleKind)}>
              {STYLE_KINDS.map((kind) => <option key={kind} value={kind}>{layerStyleKindLabels[kind]}</option>)}
            </Select>
            <Button type="button" onClick={() => performDiscreteEdit(addStyle)}>Add</Button>
          </div>
        </div>
      </div>
      </LayerStyleInteractionContext.Provider>
  );
};
