import {
  AngleControl as BaseAngleField,
  SelectField as BaseSelectField,
  SwitchControl as BaseSwitchControl
} from '@lighttable/ui';
import React from 'react';
import {
  PanelCheckboxField as BaseToggleField,
  PanelColorSwatch as BaseColorSwatch,
  PanelNumberSlider as BaseNumberSlider
} from '../../../ui/PanelControls';
import { LayerStyleContourEditor as BaseLayerStyleContourEditor } from './LayerStyleContourEditor';
import { LayerStyleGradientEditor as BaseLayerStyleGradientEditor } from './LayerStyleGradientEditor';
import type { LayerStyleInteractionAdmission } from '../../application/styles/useLayerStyleEditorController';

export interface LayerStyleInteractionCallbacks {
  start(): LayerStyleInteractionAdmission;
  finish(admission: LayerStyleInteractionAdmission): void;
  cancel(admission: LayerStyleInteractionAdmission): void;
}

export const LayerStyleInteractionContext =
  React.createContext<LayerStyleInteractionCallbacks | null>(null);

const useInteraction = () => React.useContext(LayerStyleInteractionContext);
const asAdmission = (value: object | void) => value as LayerStyleInteractionAdmission | undefined;

export const NumberSlider: React.FC<React.ComponentProps<typeof BaseNumberSlider>> = (props) => {
  const interaction = useInteraction();
  return <BaseNumberSlider {...props}
    onChange={(value, admission) => {
      if ((admission as LayerStyleInteractionAdmission | undefined)?.status === 'rejected') return;
      props.onChange(value, admission);
    }}
    onInteractionStart={() => {
      props.onInteractionStart?.();
      const admission = interaction?.start();
      return admission?.status === 'rejected' ? false : admission;
    }}
    onInteractionEnd={(handle) => {
      props.onInteractionEnd?.(handle);
      const admission = asAdmission(handle);
      if (admission) interaction?.finish(admission);
    }}
    onInteractionCancel={(handle) => {
      props.onInteractionCancel?.(handle);
      const admission = asAdmission(handle);
      if (admission) interaction?.cancel(admission);
    }} />;
};

export const ToggleField: React.FC<React.ComponentProps<typeof BaseToggleField>> = ({
  onChange, ...props
}) => {
  const interaction = useInteraction();
  return <BaseToggleField {...props} onChange={(checked) => {
    if (!interaction) { onChange(checked); return; }
    const handle = interaction?.start();
    if (!handle || handle.status === 'rejected') return;
    onChange(checked);
    interaction?.finish(handle);
  }} />;
};

export const SelectField: React.FC<React.ComponentProps<typeof BaseSelectField>> = ({
  onChange, ...props
}) => {
  const interaction = useInteraction();
  return <BaseSelectField {...props} onChange={(value) => {
    if (!interaction) { onChange(value); return; }
    const handle = interaction?.start();
    if (!handle || handle.status === 'rejected') return;
    onChange(value);
    interaction?.finish(handle);
  }} />;
};

export const SwitchControl: React.FC<React.ComponentProps<typeof BaseSwitchControl>> = ({
  onCheckedChange, ...props
}) => {
  const interaction = useInteraction();
  return <BaseSwitchControl {...props} onCheckedChange={(checked) => {
    if (!interaction) { onCheckedChange(checked); return; }
    const handle = interaction?.start();
    if (!handle || handle.status === 'rejected') return;
    onCheckedChange(checked);
    interaction?.finish(handle);
  }} />;
};

export const ColorSwatch = <T extends React.ComponentProps<typeof BaseColorSwatch>['value']>(
  props: React.ComponentProps<typeof BaseColorSwatch<T>>
) => {
  const interaction = useInteraction();
  return <BaseColorSwatch {...props}
    onChange={(value, handle) => {
      const admission = asAdmission(handle);
      if (admission?.status === 'rejected') return;
      props.onChange(value, handle);
    }}
    onInteractionStart={() => {
      props.onInteractionStart?.();
      const admission = interaction?.start();
      return admission?.status === 'rejected' ? false : admission;
    }}
    onInteractionCommit={(handle) => {
      props.onInteractionCommit?.(handle);
      const admission = asAdmission(handle);
      if (admission) interaction?.finish(admission);
    }}
    onInteractionCancel={(handle) => {
      props.onInteractionCancel?.(handle);
      const admission = asAdmission(handle);
      if (admission) interaction?.cancel(admission);
    }} />;
};

export const AngleField: React.FC<React.ComponentProps<typeof BaseAngleField>> = (props) => {
  const interaction = useInteraction();
  const continuousRef = React.useRef(false);
  const handleRef = React.useRef<LayerStyleInteractionAdmission | null>(null);
  return <BaseAngleField {...props}
    onChange={(value) => {
      if (!interaction) { props.onChange(value); return; }
      if (continuousRef.current) {
        props.onChange(value);
        return;
      }
      const handle = interaction?.start();
      if (!handle || handle.status === 'rejected') return;
      props.onChange(value);
      interaction?.finish(handle);
    }}
    onInteractionStart={() => {
      continuousRef.current = true;
      props.onInteractionStart?.();
      handleRef.current = interaction?.start() ?? null;
      if (handleRef.current?.status === 'rejected') continuousRef.current = false;
      return handleRef.current?.status === 'rejected'
        ? false
        : handleRef.current ?? undefined;
    }}
    onInteractionEnd={() => {
      continuousRef.current = false;
      props.onInteractionEnd?.();
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) interaction?.finish(handle);
    }}
    onInteractionCancel={() => {
      continuousRef.current = false;
      props.onInteractionCancel?.();
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) interaction?.cancel(handle);
    }} />;
};

export const LayerStyleGradientEditor: React.FC<
  React.ComponentProps<typeof BaseLayerStyleGradientEditor>
> = (props) => {
  const interaction = useInteraction();
  return <BaseLayerStyleGradientEditor {...props}
    onChange={(value, handle) => {
      const admission = asAdmission(handle);
      if (admission?.status === 'rejected') return;
      props.onChange(value, handle);
    }}
    onInteractionStart={() => {
      props.onInteractionStart?.();
      const admission = interaction?.start();
      return admission?.status === 'rejected' ? false : admission;
    }}
    onInteractionEnd={(handle) => {
      props.onInteractionEnd?.();
      const admission = asAdmission(handle);
      if (admission) interaction?.finish(admission);
    }}
    onInteractionCancel={(handle) => {
      props.onInteractionCancel?.();
      const admission = asAdmission(handle);
      if (admission) interaction?.cancel(admission);
    }} />;
};

export const LayerStyleContourEditor: React.FC<
  React.ComponentProps<typeof BaseLayerStyleContourEditor>
> = (props) => {
  const interaction = useInteraction();
  return <BaseLayerStyleContourEditor {...props}
    onChange={(value, handle) => {
      const admission = asAdmission(handle);
      if (admission?.status === 'rejected') return;
      props.onChange(value, handle);
    }}
    onInteractionStart={() => {
      props.onInteractionStart?.();
      const admission = interaction?.start();
      return admission?.status === 'rejected' ? false : admission;
    }}
    onInteractionEnd={(handle) => {
      props.onInteractionEnd?.();
      const admission = asAdmission(handle);
      if (admission) interaction?.finish(admission);
    }}
    onInteractionCancel={(handle) => {
      props.onInteractionCancel?.();
      const admission = asAdmission(handle);
      if (admission) interaction?.cancel(admission);
    }} />;
};
