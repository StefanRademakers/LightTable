import type { ReactNode } from 'react';

export const LIGHTTABLE_WORKSPACE_PANEL_IDS = {
  documentHost: 'lighttable.document-host',
  scopes: 'lighttable.scopes',
  properties: 'lighttable.inspector',
  layers: 'lighttable.layers',
  channels: 'lighttable.channels',
  debug: 'lighttable.debug',
  agent: 'lighttable.agent-activity',
  genAi: 'lighttable.genai',
  aiHistory: 'lighttable.ai-history'
} as const;

export type LightTableWorkspacePanelId =
  (typeof LIGHTTABLE_WORKSPACE_PANEL_IDS)[keyof typeof LIGHTTABLE_WORKSPACE_PANEL_IDS];

export interface LightTableWorkspacePanelRegistration {
  id: LightTableWorkspacePanelId | (string & {});
  contentKey: string;
  title: string;
  content: ReactNode;
  defaultPosition: {
    referencePanelId: LightTableWorkspacePanelId | (string & {});
    direction: 'left' | 'right' | 'above' | 'below' | 'within';
  };
  initiallyInactive?: boolean;
  initialWidth?: number;
  initialHeight?: number;
  minimumHeight?: number;
  defaultFloating?: {
    width: number;
    height: number;
    /** Position within the workspace, expressed as a 0..1 ratio. */
    xRatio: number;
    yRatio: number;
  };
  requiredForSavedLayout?: boolean;
}

export interface DefaultLightTableWorkspacePanelContent {
  scopes: ReactNode;
  properties: ReactNode;
  layers: ReactNode;
  channels: ReactNode;
  debug: ReactNode;
  agent: ReactNode;
  genAi: ReactNode;
  aiHistory: ReactNode;
}

/**
 * The built-in registry is the only place that decides which accessory
 * panels exist and where a fresh workspace places them. Dockview owns layout;
 * feature composition owns panel content.
 */
export const createDefaultLightTableWorkspacePanels = (
  content: DefaultLightTableWorkspacePanelContent
): LightTableWorkspacePanelRegistration[] => [
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
    contentKey: 'layers',
    title: 'Layers',
    content: content.layers,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
      direction: 'within'
    },
    initialWidth: 260,
    initialHeight: 370,
    minimumHeight: 140,
    defaultFloating: {
      width: 260,
      height: 370,
      xRatio: 0.34,
      yRatio: 0.27
    },
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
    contentKey: 'channels',
    title: 'Channels',
    content: content.channels,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
    contentKey: 'scopes',
    title: 'Scopes',
    content: content.scopes,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
    contentKey: 'properties',
    title: 'Properties',
    content: content.properties,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
      direction: 'right'
    },
    initialWidth: 250,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
    contentKey: 'aiHistory',
    title: 'Assets',
    content: content.aiHistory,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
    contentKey: 'genAi',
    title: 'GenAI',
    content: content.genAi,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.agent,
    contentKey: 'agent',
    title: 'Agent',
    content: content.agent,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
    contentKey: 'debug',
    title: 'Debug',
    content: content.debug,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      direction: 'within'
    },
    initiallyInactive: true
  }
];
