import React from 'react';
import { ScopesPanel } from '../../ScopesPanel';
import { DebugPanel } from '../../editor/ui/DebugPanel';
import { GradePanel } from '../../editor/panels/GradePanel';
import { TextPropertiesPanel } from '../../editor/panels/TextPropertiesPanel';
import {
  LensFxPanel
} from '../../editor/panels/LensFxPanel';
import { LayerStylesPanel } from '../../editor/panels/LayerStylesPanel';
import { DocumentColorPanel } from '../../editor/panels/DocumentColorPanel';
import { AgentActivityPanel } from '../../editor/panels/AgentActivityPanel';
import { GenAiPanel } from '../../../genai/ui/GenAiPanel';
import { AiHistoryPanel } from '../../../genai/ui/AiHistoryPanel';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  createDefaultLightTableWorkspacePanels,
  type LightTableWorkspacePanelRegistration
} from '../../editor/workspace/workspacePanelRegistry';

export interface EditorWorkspacePanelBindings {
  scopes: React.ComponentProps<typeof ScopesPanel>;
  layers: React.ReactNode;
  channels: React.ReactNode;
  debug: React.ComponentProps<typeof DebugPanel>;
  lensFxKey: string;
  lensFx: React.ComponentProps<typeof LensFxPanel>;
  grade: React.ComponentProps<typeof GradePanel>;
  effects: {
    document: ImageDocument | null;
    controller: LayerStyleEditorController;
  };
  color: React.ComponentProps<typeof DocumentColorPanel>;
  text: React.ComponentProps<typeof TextPropertiesPanel> | null;
  agent: React.ComponentProps<typeof AgentActivityPanel>;
  genAi: React.ComponentProps<typeof GenAiPanel>;
  aiHistory: React.ComponentProps<typeof AiHistoryPanel>;
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
  lensFxKey,
  lensFx,
  grade,
  effects,
  color,
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
    lensFx: <LensFxPanel key={lensFxKey} {...lensFx} />,
    grade: <GradePanel {...grade} />,
    effects: <LayerStylesPanel {...effects} />,
    color: <DocumentColorPanel {...color} />,
    agent: <AgentActivityPanel {...agent} />,
    genAi: <GenAiPanel {...genAi} />,
    aiHistory: <AiHistoryPanel {...aiHistory} />,
    text: text
      ? <TextPropertiesPanel {...text} />
      : <aside className="lighttable-panel" aria-label="Text properties" />
  });
