import { describe, expect, it } from 'vitest';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './workspacePanelRegistry';

describe('workspacePanelRegistry', () => {
  it('registers built-in panels in dependency-safe layout order', () => {
    const content = {
      scopes: 'scopes',
      grade: 'grade',
      lensFx: 'lensFx',
      layers: 'layers',
      debug: 'debug'
    };

    const panels = createDefaultLightTableWorkspacePanels(content);

    expect(panels.map((panel) => panel.id)).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers
    ]);
    expect(panels.map((panel) => panel.content)).toEqual([
      content.scopes,
      content.grade,
      content.debug,
      content.lensFx,
      content.layers
    ]);
    expect(panels.map((panel) => panel.contentKey)).toEqual([
      'scopes',
      'grade',
      'debug',
      'lensFx',
      'layers'
    ]);
    expect(
      panels
        .filter((panel) => panel.requiredForSavedLayout)
        .map((panel) => panel.id)
    ).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers
    ]);
  });

  it('keeps the debug panel available without making old saved layouts invalid', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      lensFx: null,
      layers: null,
      debug: null
    });
    const debugPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.debug
    );

    expect(debugPanel).toMatchObject({
      initiallyInactive: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
        direction: 'within'
      }
    });
    expect(debugPanel?.requiredForSavedLayout).toBeUndefined();
  });
});
