import React from 'react';
import { ScopesPanel } from '../../ScopesPanel';
import { DebugPanel } from '../../editor/ui/DebugPanel';
import { GradePanel } from '../../editor/panels/GradePanel';
import { TextPropertiesPanel } from '../../editor/panels/TextPropertiesPanel';
import {
  LensFxPanel
} from '../../editor/panels/LensFxPanel';
import { LayerStylesPanel } from '../../editor/panels/LayerStylesPanel';
import { PropertiesPanel } from '../../editor/panels/PropertiesPanel';
import { AgentActivityPanel } from '../../editor/panels/AgentActivityPanel';
import { GenAiPanel } from '../../../genai/ui/GenAiPanel';
import { ProjectAssetBrowser } from '../../../genai/ui/ProjectAssetBrowser';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { PropertiesInspectorView } from '../../application/properties/propertiesInspectorTarget';
import {
  createDefaultLightTableWorkspacePanels,
  type LightTableWorkspacePanelRegistration
} from '../../editor/workspace/workspacePanelRegistry';

export interface EditorWorkspacePanelBindings {
  scopes: React.ComponentProps<typeof ScopesPanel>;
  layers: React.ReactNode;
  channels: React.ReactNode;
  debug: React.ComponentProps<typeof DebugPanel>;
  propertiesView: PropertiesInspectorView;
  lensFxKey: string;
  lensFx: React.ComponentProps<typeof LensFxPanel>;
  grade: React.ComponentProps<typeof GradePanel>;
  effects: {
    document: ImageDocument | null;
    controller: LayerStyleEditorController;
  };
  text: React.ComponentProps<typeof TextPropertiesPanel> | null;
  agent: React.ComponentProps<typeof AgentActivityPanel>;
  genAi: React.ComponentProps<typeof GenAiPanel>;
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
  agent,
  genAi,
  aiHistory
}: EditorWorkspacePanelBindings): LightTableWorkspacePanelRegistration[] =>
  createDefaultLightTableWorkspacePanels({
    scopes: <ScopesPanel {...scopes} />,
    layers,
    channels,
    debug: <DebugPanel {...debug} />,
    properties: (
      <PropertiesPanel
        view={propertiesView}
        grade={<GradePanel {...grade} />}
        lensFx={<LensFxPanel key={lensFxKey} {...lensFx} />}
        effects={<LayerStylesPanel {...effects} />}
        text={text
          ? <TextPropertiesPanel {...text} />
          : <aside className="lighttable-panel" aria-label="Text properties" />}
      />
    ),
    agent: <AgentActivityPanel {...agent} />,
    genAi: <GenAiPanel {...genAi} />,
    aiHistory: <ProjectAssetBrowser {...aiHistory} />
  });
