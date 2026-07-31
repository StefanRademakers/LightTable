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
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers
    ]);
    expect(panels.map((panel) => panel.content)).toEqual([
      content.scopes,
      content.grade,
      content.lensFx,
      content.debug,
      content.layers
    ]);
    expect(panels.map((panel) => panel.contentKey)).toEqual([
      'scopes',
      'grade',
      'lensFx',
      'debug',
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

  it('groups Lens Fx and Debug with Grade while keeping Grade active by default', () => {
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
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
        direction: 'within'
      }
    });
    expect(debugPanel?.requiredForSavedLayout).toBeUndefined();
  });

  it('starts Layers as a compact floating panel over the document', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      lensFx: null,
      layers: null,
      debug: null
    });
    const layersPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.layers
    );

    expect(layersPanel).toMatchObject({
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'within'
      },
      defaultFloating: {
        width: 260,
        height: 370,
        xRatio: 0.34,
        yRatio: 0.27
      }
    });
  });
});
