import React from 'react';
import { GradePanel } from '../../editor/panels/GradePanel';
import {
  isPhotoshopAdjustmentKind,
  PHOTOSHOP_ADJUSTMENT_KINDS
} from '../../photoshopAdjustments';
import { PropertiesPanel } from '../../editor/panels/PropertiesPanel';
import { ProjectAssetBrowser } from '../../../genai/ui/ProjectAssetBrowser';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { PropertiesInspectorView } from '../../application/properties/propertiesInspectorTarget';
import {
  createDefaultLightTableWorkspacePanels,
  type LightTableWorkspacePanelRegistration
} from '../../editor/workspace/workspacePanelRegistry';

type ScopesPanelComponent = typeof import('../../ScopesPanel')['ScopesPanel'];
type DebugPanelComponent = typeof import('../../editor/ui/DebugPanel')['DebugPanel'];
type AgentActivityPanelComponent =
  typeof import('../../editor/panels/AgentActivityPanel')['AgentActivityPanel'];
type ActionsPanelComponent =
  typeof import('../../editor/panels/actions/ActionsPanel')['ActionsPanel'];
type GenAiPanelComponent = typeof import('../../../genai/ui/GenAiPanel')['GenAiPanel'];
type LensFxPanelComponent = typeof import('../../editor/panels/LensFxPanel')['LensFxPanel'];
type TextPropertiesPanelComponent =
  typeof import('../../editor/panels/TextPropertiesPanel')['TextPropertiesPanel'];
type GaussianBlurPropertiesPanelComponent =
  typeof import('../../editor/panels/GaussianBlurPropertiesPanel')['GaussianBlurPropertiesPanel'];

// Dockview renders accessory panels only while they are visible. Match that
// runtime boundary at the module level: opening the editor must not evaluate
// Actions, Agent, Debug, GenAI or Scopes code before the user opens that tab.
const ScopesPanel = React.lazy(async () => ({
  default: (await import('../../ScopesPanel')).ScopesPanel
}));
const DebugPanel = React.lazy(async () => ({
  default: (await import('../../editor/ui/DebugPanel')).DebugPanel
}));
const AgentActivityPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/AgentActivityPanel')).AgentActivityPanel
}));
const ActionsPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/actions/ActionsPanel')).ActionsPanel
}));
const GenAiPanel = React.lazy(async () => ({
  default: (await import('../../../genai/ui/GenAiPanel')).GenAiPanel
}));
const CurvesPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/CurvesPropertiesPanel')).CurvesPropertiesPanel
}));
const AdjustmentPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/AdjustmentPropertiesPanel')).AdjustmentPropertiesPanel
}));
const GradientMapPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/GradientMapPropertiesPanel')).GradientMapPropertiesPanel
}));
const PhotoshopAdjustmentPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/PhotoshopAdjustmentPropertiesPanel'))
    .PhotoshopAdjustmentPropertiesPanel
}));
const GrainPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/GrainPropertiesPanel')).GrainPropertiesPanel
}));
const LensFxPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/LensFxPanel')).LensFxPanel
}));
const LayerStylesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/LayerStylesPanel')).LayerStylesPanel
}));
const TextPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/TextPropertiesPanel')).TextPropertiesPanel
}));
const GaussianBlurPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/GaussianBlurPropertiesPanel'))
    .GaussianBlurPropertiesPanel
}));

const deferPanel = (content: React.ReactNode) => (
  <React.Suspense fallback={<aside className="lighttable-panel" aria-label="Loading panel" />}>
    {content}
  </React.Suspense>
);

export interface EditorWorkspacePanelBindings {
  scopes: React.ComponentProps<ScopesPanelComponent>;
  layers: React.ReactNode;
  channels: React.ReactNode;
  debug: React.ComponentProps<DebugPanelComponent>;
  propertiesView: PropertiesInspectorView;
  lensFxKey: string;
  lensFx: React.ComponentProps<LensFxPanelComponent>;
  grade: React.ComponentProps<typeof GradePanel>;
  effects: {
    document: ImageDocument | null;
    controller: LayerStyleEditorController;
  };
  text: React.ComponentProps<TextPropertiesPanelComponent> | null;
  gaussianBlur: React.ComponentProps<GaussianBlurPropertiesPanelComponent> | null;
  agent: React.ComponentProps<AgentActivityPanelComponent>;
  actions: React.ComponentProps<ActionsPanelComponent>;
  genAi: React.ComponentProps<GenAiPanelComponent>;
  aiHistory: React.ComponentProps<typeof ProjectAssetBrowser>;
}

/**
 * Owns the built-in feature-view composition for the workspace registry.
 *
 * The document composition root provides projected models and command ports;
 * it does not need to know how those ports are mounted into React panels.
 */
export const createEditorWorkspacePanels = ({
  scopes,
  layers,
  channels,
  debug,
  propertiesView,
  lensFxKey,
  lensFx,
  grade,
  effects,
  text,
  gaussianBlur,
  agent,
  actions,
  genAi,
  aiHistory
}: EditorWorkspacePanelBindings): LightTableWorkspacePanelRegistration[] =>
  createDefaultLightTableWorkspacePanels({
    scopes: deferPanel(<ScopesPanel {...scopes} />),
    layers,
    channels,
    debug: deferPanel(<DebugPanel {...debug} />),
    properties: (
      <PropertiesPanel
        view={propertiesView}
        editors={{
          grade: <GradePanel {...grade} />,
          curves: deferPanel(<CurvesPropertiesPanel {...grade} />),
          exposure: deferPanel(<PhotoshopAdjustmentPropertiesPanel kind="exposure" {...grade} />),
          'color-vibrance': deferPanel(
            <PhotoshopAdjustmentPropertiesPanel kind="color-vibrance" {...grade} />
          ),
          'gradient-map': deferPanel(<GradientMapPropertiesPanel {...grade} />),
          'clarity-dehaze': deferPanel(
            <AdjustmentPropertiesPanel title="Clarity and Dehaze" {...grade} />
          ),
          grain: deferPanel(<GrainPropertiesPanel {...lensFx} />),
          'gaussian-blur': gaussianBlur
            ? deferPanel(<GaussianBlurPropertiesPanel {...gaussianBlur} />)
            : <aside className="lighttable-panel" aria-label="Gaussian Blur properties" />,
          'lens-fx': deferPanel(<LensFxPanel key={lensFxKey} {...lensFx} />),
          effects: deferPanel(<LayerStylesPanel {...effects} />),
          text: text
            ? deferPanel(<TextPropertiesPanel {...text} />)
            : <aside className="lighttable-panel" aria-label="Text properties" />,
          ...Object.fromEntries(PHOTOSHOP_ADJUSTMENT_KINDS
            .filter((kind) => kind !== 'exposure' && kind !== 'color-vibrance')
            .map((kind) => [kind, isPhotoshopAdjustmentKind(kind)
              ? deferPanel(
                  <PhotoshopAdjustmentPropertiesPanel key={kind} kind={kind} {...grade} />
                )
              : null]))
        }}
      />
    ),
    agent: deferPanel(<AgentActivityPanel {...agent} />),
    actions: deferPanel(<ActionsPanel {...actions} />),
    genAi: deferPanel(<GenAiPanel {...genAi} />),
    aiHistory: <ProjectAssetBrowser {...aiHistory} />
  });
