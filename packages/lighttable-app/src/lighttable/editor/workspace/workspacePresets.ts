import {
  LIGHTTABLE_WORKSPACE_PANEL_IDS,
  type LightTableWorkspacePanelRegistration
} from './workspacePanelRegistry';

export type SelectableLightTableWorkspacePreset = 'photo-edit' | 'ai-generation';

const positioned = (
  panel: LightTableWorkspacePanelRegistration,
  referencePanelId: LightTableWorkspacePanelRegistration['defaultPosition']['referencePanelId'],
  direction: LightTableWorkspacePanelRegistration['defaultPosition']['direction'],
  initiallyInactive: boolean
): LightTableWorkspacePanelRegistration => ({
  ...panel,
  defaultPosition: { referencePanelId, direction },
  initiallyInactive
});

/** Changes only Dockview placement; panel identity, content and commands stay shared. */
export const panelsForWorkspacePreset = (
  panels: readonly LightTableWorkspacePanelRegistration[],
  preset: SelectableLightTableWorkspacePreset
): LightTableWorkspacePanelRegistration[] => panels.map((panel) => {
  if (preset === 'photo-edit') return panel;

  switch (panel.id) {
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'left', false);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.agent:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi, 'within', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.grade:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'right', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx:
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.effects:
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.text:
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.debug:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.grade, 'within', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.grade, 'within', false);
    default:
      return panel;
  }
});
