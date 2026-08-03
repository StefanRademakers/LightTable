import React from 'react';
import { ScopesPanel } from '../../ScopesPanel';
import { DebugPanel } from '../../editor/ui/DebugPanel';
import { PropertiesPanel } from '../../editor/panels/PropertiesPanel';
import {
  LensFxPanel
} from '../../editor/panels/LensFxPanel';
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
  grade: React.ComponentProps<typeof PropertiesPanel>;
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
  grade
}: EditorWorkspacePanelBindings): LightTableWorkspacePanelRegistration[] =>
  createDefaultLightTableWorkspacePanels({
    scopes: <ScopesPanel {...scopes} />,
    layers,
    channels,
    debug: <DebugPanel {...debug} />,
    lensFx: <LensFxPanel key={lensFxKey} {...lensFx} />,
    grade: <PropertiesPanel {...grade} />
  });
