import {
  LIGHTTABLE_WORKSPACE_PANEL_IDS,
  type LightTableWorkspacePanelRegistration
} from './workspacePanelRegistry';

export type SelectableLightTableWorkspacePreset = 'photo-edit' | 'grading' | 'ai-generation' | 'video';

/**
 * Product defaults for panel visibility. A panel remains registered when it
 * is absent here, so View > Panels can add it without constructing a second
 * workspace implementation. User changes are persisted as a custom layout;
 * resetting a workspace returns to this list and the positions below.
 */
export const WORKSPACE_VISIBLE_PANEL_IDS: Record<
  SelectableLightTableWorkspacePreset,
  readonly string[]
> = {
  'photo-edit': [
    LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
  ],
  grading: [
    LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
  ],
  'ai-generation': [
    LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
    LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
  ],
  video: [
    LIGHTTABLE_WORKSPACE_PANEL_IDS.videoControls
  ]
};

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
): LightTableWorkspacePanelRegistration[] => panels
  .filter((panel) => WORKSPACE_VISIBLE_PANEL_IDS[preset].includes(panel.id))
  .map((panel) => {
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

  if (preset === 'video') {
    switch (panel.id) {
      case LIGHTTABLE_WORKSPACE_PANEL_IDS.videoControls:
        return positioned(panel, LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost, 'below', false);
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
