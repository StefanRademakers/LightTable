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
import { FILTER_DEFINITIONS } from '@lighttable/filter-core';
import { ColorPicker, colorPickerHex, colorPickerParseHex } from '../../../ui/ColorPicker';

type ScopesPanelComponent = typeof import('../../ScopesPanel')['ScopesPanel'];
type DebugPanelComponent = typeof import('../../editor/ui/DebugPanel')['DebugPanel'];
type AgentActivityPanelComponent =
  typeof import('../../editor/panels/AgentActivityPanel')['AgentActivityPanel'];
type ActionsPanelComponent =
  typeof import('../../editor/panels/actions/ActionsPanel')['ActionsPanel'];
type HistoryPanelComponent =
  typeof import('../../editor/panels/history/HistoryPanel')['HistoryPanel'];
type GenAiPanelComponent = typeof import('../../../genai/ui/GenAiPanel')['GenAiPanel'];
type LensFxPanelComponent = typeof import('../../editor/panels/LensFxPanel')['LensFxPanel'];
type TextPropertiesPanelComponent =
  typeof import('../../editor/panels/TextPropertiesPanel')['TextPropertiesPanel'];
type P0FilterPropertiesPanelComponent =
  typeof import('../../editor/panels/P0FilterPropertiesPanel')['P0FilterPropertiesPanel'];

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
const HistoryPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/history/HistoryPanel')).HistoryPanel
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
const P0FilterPropertiesPanel = React.lazy(async () => ({
  default: (await import('../../editor/panels/P0FilterPropertiesPanel'))
    .P0FilterPropertiesPanel
}));

const deferPanel = (content: React.ReactNode) => (
  <React.Suspense fallback={<aside className="lighttable-panel" aria-label="Loading panel" />}>
    {content}
  </React.Suspense>
);

export interface EditorWorkspacePanelBindings {
  documentKind?: 'image' | 'video' | 'model-3d';
  videoControls?: React.ReactNode;
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
  p0Filter: React.ComponentProps<P0FilterPropertiesPanelComponent> | null;
  agent: React.ComponentProps<AgentActivityPanelComponent>;
  actions: React.ComponentProps<ActionsPanelComponent>;
  history: React.ComponentProps<HistoryPanelComponent>;
  genAi: React.ComponentProps<GenAiPanelComponent>;
  aiHistory: React.ComponentProps<typeof ProjectAssetBrowser>;
  color: {
    readonly value: string;
    readonly onChange: (value: string) => void;
  };
}

/**
 * Owns the built-in feature-view composition for the workspace registry.
 *
 * The document composition root provides projected models and command ports;
 * it does not need to know how those ports are mounted into React panels.
 */
export const createEditorWorkspacePanels = ({
  documentKind = 'image',
  videoControls,
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
  p0Filter,
  agent,
  actions,
  history,
  genAi,
  aiHistory,
  color
}: EditorWorkspacePanelBindings): LightTableWorkspacePanelRegistration[] =>
  createDefaultLightTableWorkspacePanels({
    scopes: documentKind === 'image'
      ? deferPanel(<ScopesPanel {...scopes} />)
      : <DocumentKindPanel title="Scopes" kind={documentKind} detail="Frame scopes are unavailable in this read-only viewer." />,
    layers: documentKind === 'image'
      ? layers
      : <DocumentKindPanel title="Layers" kind={documentKind} detail="This document has no image layer stack." />,
    channels: documentKind === 'image'
      ? channels
      : <DocumentKindPanel title="Channels" kind={documentKind} detail="Decoded media channels are not editable layers." />,
    debug: deferPanel(<DebugPanel {...debug} />),
    properties: documentKind === 'image' ? (
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
          ...Object.fromEntries(FILTER_DEFINITIONS.map(({ kind, label }) => [kind, p0Filter
            ? deferPanel(<P0FilterPropertiesPanel {...p0Filter} />)
            : <aside className="lighttable-panel" aria-label={`${label} properties`} />])),
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
    ) : <DocumentKindPanel title="Properties" kind={documentKind} detail="Playback is read-only. Use the controls on the document surface." />,
    agent: deferPanel(<AgentActivityPanel {...agent} />),
    actions: deferPanel(<ActionsPanel {...actions} />),
    history: deferPanel(<HistoryPanel {...history} />),
    genAi: deferPanel(<GenAiPanel {...genAi} />),
    aiHistory: <ProjectAssetBrowser {...aiHistory} />,
    color: <aside className="lighttable-color-panel" aria-label="Color">
      <ColorPicker
        variant="panel"
        value={colorPickerParseHex(color.value) ?? { r: 0, g: 0, b: 0, a: 1 }}
        onChange={(value) => color.onChange(colorPickerHex(value).toLowerCase())}
      />
    </aside>,
    videoControls: videoControls ?? (
      <DocumentKindPanel
        title="Video Controls"
        kind="video"
        detail="Open a video document to use playback controls."
      />
    )
  });

const DocumentKindPanel = ({
  title,
  kind,
  detail
}: {
  readonly title: string;
  readonly kind: 'video' | 'model-3d';
  readonly detail: string;
}) => (
  <aside className="lighttable-panel lighttable-document-kind-panel" aria-label={title}>
    <strong>{kind === 'video' ? 'Video document' : '3D document'}</strong>
    <p>{detail}</p>
  </aside>
);
