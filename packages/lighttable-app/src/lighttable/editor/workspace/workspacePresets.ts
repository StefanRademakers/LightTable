import {
  LIGHTTABLE_WORKSPACE_PANEL_IDS,
  type LightTableWorkspacePanelRegistration
} from './workspacePanelRegistry';

export type SelectableLightTableWorkspacePreset = 'photo-edit' | 'grading' | 'ai-generation';

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

  if (preset === 'grading') {
    switch (panel.id) {
      case LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes:
        return {
          ...positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'left', false),
          initialWidth: 300
        };
      case LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi:
        return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes, 'within', true);
      case LIGHTTABLE_WORKSPACE_PANEL_IDS.agent:
        return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes, 'within', true);
      default:
        return panel;
    }
  }

  switch (panel.id) {
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'left', false);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.agent:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi, 'within', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.properties:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'right', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.debug:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.properties, 'within', true);
    case LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory:
      return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.properties, 'within', false);
    default:
      return panel;
  }
});
