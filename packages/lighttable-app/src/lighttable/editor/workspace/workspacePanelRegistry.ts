import type { ReactNode } from 'react';

export const LIGHTTABLE_WORKSPACE_PANEL_IDS = {
  documentHost: 'lighttable.document-host',
  scopes: 'lighttable.scopes',
  properties: 'lighttable.inspector',
  layers: 'lighttable.layers',
  channels: 'lighttable.channels',
  debug: 'lighttable.debug',
  agent: 'lighttable.agent-activity',
  actions: 'lighttable.actions',
  history: 'lighttable.history',
  genAi: 'lighttable.genai',
  aiHistory: 'lighttable.ai-history',
  color: 'lighttable.color',
  videoControls: 'lighttable.video-controls'
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
  /** Hide the Dockview tab strip while this is the sole panel in a docked group. */
  hideHeaderWhenAlone?: boolean;
  /** Register the panel for menus and explicit opening without showing it in a fresh layout. */
  initiallyAbsent?: boolean;
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
  actions: ReactNode;
  history: ReactNode;
  genAi: ReactNode;
  aiHistory: ReactNode;
  color?: ReactNode;
  videoControls?: ReactNode;
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
      xRatio: 0.67,
      yRatio: 0.58
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
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.actions,
    contentKey: 'actions',
    title: 'Actions',
    content: content.actions,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.history,
    contentKey: 'history',
    title: 'History',
    content: content.history,
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
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.color,
    contentKey: 'color',
    title: 'Color',
    content: content.color ?? null,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
      direction: 'within'
    },
    initiallyAbsent: true,
    defaultFloating: {
      width: 338,
      height: 500,
      xRatio: 0.08,
      yRatio: 0.42
    }
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.videoControls,
    contentKey: 'videoControls',
    title: 'Video Controls',
    content: content.videoControls,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
      direction: 'below'
    },
    initialHeight: 68,
    minimumHeight: 68,
    hideHeaderWhenAlone: true,
    initiallyInactive: false
  }
];
