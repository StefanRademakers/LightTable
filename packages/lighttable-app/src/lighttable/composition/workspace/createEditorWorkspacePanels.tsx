import React from 'react';
import { ScopesPanel } from '../../ScopesPanel';
import { DebugPanel } from '../../editor/ui/DebugPanel';
import {
  GradePanel
} from '../../editor/panels/GradePanel';
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
  debug: React.ComponentProps<typeof DebugPanel>;
  lensFxKey: string;
  lensFx: React.ComponentProps<typeof LensFxPanel>;
  grade: React.ComponentProps<typeof GradePanel>;
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
  debug,
  lensFxKey,
  lensFx,
  grade
}: EditorWorkspacePanelBindings): LightTableWorkspacePanelRegistration[] =>
  createDefaultLightTableWorkspacePanels({
    scopes: <ScopesPanel {...scopes} />,
    layers,
    debug: <DebugPanel {...debug} />,
    lensFx: <LensFxPanel key={lensFxKey} {...lensFx} />,
    grade: <GradePanel {...grade} />
  });
