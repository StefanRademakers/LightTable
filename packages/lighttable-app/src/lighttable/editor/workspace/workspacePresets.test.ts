import { describe, expect, it } from 'vitest';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './workspacePanelRegistry';
import { panelsForWorkspacePreset } from './workspacePresets';

const panels = () => createDefaultLightTableWorkspacePanels({
  scopes: null,
  grade: null,
  effects: null,
  text: null,
  lensFx: null,
  layers: null,
  channels: null,
  debug: null,
  agent: null,
  genAi: null,
  aiHistory: null
});

describe('workspace presets', () => {
  it('keeps the canonical Photo Edit inspector order', () => {
    expect(panelsForWorkspacePreset(panels(), 'photo-edit').slice(3).map(({ title }) => title))
      .toEqual(['Grade', 'Lens Fx', 'Assets', 'Effects', 'GenAI', 'Agent', 'Text', 'Debug']);
  });

  it('places GenAI and Agent left and activates Assets on the right', () => {
    const preset = panelsForWorkspacePreset(panels(), 'ai-generation');
    const find = (id: string) => preset.find((panel) => panel.id === id);

    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi)).toMatchObject({
      initiallyInactive: false,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'left'
      }
    });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.agent)?.defaultPosition)
      .toEqual({ referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi, direction: 'within' });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory)).toMatchObject({
      initiallyInactive: false,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
        direction: 'within'
      }
    });
  });
});
