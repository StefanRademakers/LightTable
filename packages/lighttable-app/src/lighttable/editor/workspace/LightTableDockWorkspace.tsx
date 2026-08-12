import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview
} from 'dockview-react';
import {
  LIGHTTABLE_WORKSPACE_PANEL_IDS,
  type LightTableWorkspacePanelRegistration
} from './workspacePanelRegistry';
import {
  clearWorkspaceLayout,
  persistWorkspaceLayout,
  readWorkspaceLayout,
  type LightTableWorkspacePreset
} from './workspaceLayoutPersistence';

const DOCUMENT_HOST_PANEL_ID = LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost;
// Increment only when the intended fresh-workspace composition changes. A
// versioned key prevents a structurally valid older layout from silently
// overriding the new product default.
const ACCESSORY_PANEL_MINIMUM_WIDTH = 250;
const ACCESSORY_PANEL_MAXIMUM_WIDTH = 520;
const PANEL_TAB_BAR_HEIGHT = 34;
const TAB_MERGE_PRIORITY_EXTENSION = 18;
const SIDE_DOCK_ACTIVATION_DISTANCE = 22;

const allowsWorkspaceDockTarget = (
  workspaceElement: HTMLElement | null,
  kind: 'tab' | 'header_space' | 'content' | 'edge',
  position: 'top' | 'bottom' | 'left' | 'right' | 'center',
  group: { readonly api: { readonly boundingBox?: {
    readonly left: number;
    readonly width: number;
  } } } | undefined,
  clientX: number
): boolean => {
  if (position === 'top' || position === 'bottom') return false;
  if (position !== 'left' && position !== 'right') return true;
  if (!workspaceElement) return false;

  const workspaceBounds = workspaceElement.getBoundingClientRect();
  const targetBounds = kind === 'edge' ? undefined : group?.api.boundingBox;
  const left = targetBounds ? workspaceBounds.left + targetBounds.left : workspaceBounds.left;
  const right = targetBounds ? left + targetBounds.width : workspaceBounds.right;
  const distance = position === 'left' ? clientX - left : right - clientX;
  return distance >= 0 && distance <= SIDE_DOCK_ACTIVATION_DISTANCE;
};

type FloatingFrameBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DockviewFloatingGroupBridge = {
  overlay: { element: HTMLElement };
  position: (bounds: FloatingFrameBounds) => void;
};

type DockviewApiFloatingGroupsBridge = {
  component?: { floatingGroups?: readonly DockviewFloatingGroupBridge[] };
};

const normalizeFloatingFrameBounds = (
  api: DockviewApi | null,
  frame: HTMLElement,
  workspaceElement: HTMLElement
) => {
  if (!api) return;
  // Dockview currently exposes floating-group positioning only on its
  // component bridge. Keep that private integration isolated here.
  const floatingGroups = (api as unknown as DockviewApiFloatingGroupsBridge)
    .component?.floatingGroups;
  const floatingGroup = floatingGroups?.find((candidate) => candidate.overlay.element === frame);
  if (!floatingGroup) return;

  const workspaceBounds = workspaceElement.getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  frame.style.removeProperty('left');
  frame.style.removeProperty('right');
  frame.style.removeProperty('top');
  frame.style.removeProperty('bottom');
  floatingGroup.position({
    left: frameBounds.left - workspaceBounds.left,
    top: frameBounds.top - workspaceBounds.top,
    width: frameBounds.width,
    height: frameBounds.height
  });
};

type WorkspaceContentKey = 'documentHost' | string;

export interface LightTableWorkspaceDocument {
  id: string;
  title: string;
  content: React.ReactNode;
  dirty?: boolean;
  thumbnailUrl?: string;
  onClose?: () => void;
}

interface LightTableDockWorkspaceProps {
  canvasOnly?: boolean;
  documents: LightTableWorkspaceDocument[];
  activeDocumentId: string;
  panels: LightTableWorkspacePanelRegistration[];
  accessoryWidthConstraintsEnabled: boolean;
  onResizeInteractionChange?: (active: boolean) => void;
  onActiveDocumentChange?: (documentId: string) => void;
  onDocumentSurfaceReady?: () => void;
}

export interface LightTableDockWorkspaceHandle {
  resetLayout: () => void;
  showPanel: (panelId: string) => void;
}

type WorkspaceContent = Record<WorkspaceContentKey, React.ReactNode>;

const WorkspaceContentContext = createContext<WorkspaceContent | null>(null);

const WorkspacePanel: React.FC<IDockviewPanelProps<{ contentKey: WorkspaceContentKey }>> = ({ params }) => {
  const content = useContext(WorkspaceContentContext);
  if (!content) return null;
  return <>{content[params.contentKey]}</>;
};

const PersistentPanelTab: React.FC<IDockviewPanelHeaderProps> = (props) => (
  <DockviewDefaultTab {...props} hideClose />
);

const applyWorkspacePanelConstraints = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean
) => {
  const minimumWidth = widthConstraintsEnabled ? ACCESSORY_PANEL_MINIMUM_WIDTH : 0;
  api.getPanel(DOCUMENT_HOST_PANEL_ID)?.api.setConstraints({
    minimumWidth
  });
  panels.forEach((panel) => {
    api.getPanel(panel.id)?.api.setConstraints({
      minimumWidth,
      maximumWidth: widthConstraintsEnabled
        ? ACCESSORY_PANEL_MAXIMUM_WIDTH
        : Number.MAX_SAFE_INTEGER,
      ...(panel.minimumHeight === undefined ? {} : { minimumHeight: panel.minimumHeight })
    });
  });
};

const synchronizeWorkspacePanelTitles = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[]
) => {
  panels.forEach((panel) => {
    const restoredPanel = api.getPanel(panel.id);
    if (restoredPanel?.api.title !== panel.title) {
      restoredPanel?.api.setTitle(panel.title);
    }
  });
};

const applyWorkspacePanelRenderers = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[]
) => {
  panels.forEach((panel) => {
    const restoredPanel = api.getPanel(panel.id);
    if (restoredPanel?.api.renderer !== 'onlyWhenVisible') {
      restoredPanel?.api.setRenderer('onlyWhenVisible');
    }
  });
};

const addRegisteredPanel = (
  api: DockviewApi,
  panel: LightTableWorkspacePanelRegistration
) => {
  const referencePanel = api.getPanel(panel.defaultPosition.referencePanelId);
  if (!referencePanel) return null;
  return api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: panel.id,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: panel.title,
    params: { contentKey: panel.contentKey },
    renderer: 'onlyWhenVisible',
    position: {
      referencePanel,
      direction: panel.defaultPosition.direction
    },
    inactive: panel.initiallyInactive,
    initialWidth: panel.initialWidth,
    initialHeight: panel.initialHeight,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH,
    minimumHeight: panel.minimumHeight
  });
};

const createDefaultLayout = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean
) => {
  const documentHost = api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: DOCUMENT_HOST_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Documents',
    params: { contentKey: 'documentHost' },
    renderer: 'always',
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH
  });
  documentHost.group.header.hidden = true;
  // Keep the document header hidden, but allow its content drop target to
  // receive panel drops. LightTable converts a centre drop there into a
  // floating panel; edge drops remain regular Dockview splits.
  documentHost.group.locked = false;
  // Build sequentially. A panel that starts floating must become a floating
  // group before a later registration can be added `within` that group.
  // Otherwise Dockview leaves the later tab behind in the original dock.
  panels.forEach((panel) => {
    const dockPanel = addRegisteredPanel(api, panel);
    const floating = panel.defaultFloating;
    if (!floating || !dockPanel) return;

    const width = Math.min(floating.width, Math.max(250, api.width - 24));
    const height = Math.min(floating.height, Math.max(240, api.height - 24));
    api.addFloatingGroup(dockPanel, {
      x: Math.max(12, Math.min(Math.round(api.width * floating.xRatio), api.width - width - 12)),
      y: Math.max(12, Math.min(Math.round(api.height * floating.yRatio), api.height - height - 12)),
      width,
      height
    });
  });
  applyWorkspacePanelConstraints(api, panels, widthConstraintsEnabled);
};

const isUsableSavedLayout = (
  layout: SerializedDockview,
  panels: LightTableWorkspacePanelRegistration[]
) =>
  Boolean(
    layout.panels[DOCUMENT_HOST_PANEL_ID] &&
    panels
      .filter((panel) => panel.requiredForSavedLayout)
      .every((panel) => layout.panels[panel.id])
  );

const restoreLayout = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean,
  layout: SerializedDockview | undefined
) => {
  try {
    if (!layout) return false;
    if (!isUsableSavedLayout(layout, panels)) {
      clearWorkspaceLayout(localStorage);
      return false;
    }
    api.fromJSON(layout);
    const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (!documentHost) return false;
    // The document host deliberately hides its Dockview header. If another
    // panel ever lands in that group, its tab becomes unreachable and replaces
    // the canvas. Reject such a saved layout instead of reopening a bricked UI.
    if (
      documentHost.group.panels.length !== 1 ||
      documentHost.group.panels[0]?.id !== DOCUMENT_HOST_PANEL_ID
    ) {
      api.clear();
      clearWorkspaceLayout(localStorage);
      return false;
    }
    documentHost.group.header.hidden = true;
    documentHost.group.locked = false;
    panels.forEach((panel) => {
      if (!api.getPanel(panel.id)) addRegisteredPanel(api, panel);
    });
    // Serialized Dockview layouts include titles. Product-owned labels remain
    // authoritative when an older saved layout is restored.
    synchronizeWorkspacePanelTitles(api, panels);
    // Older serialized layouts retain their original renderer strategy.
    // Reassert the product policy so hidden heavy inspectors do not remain
    // mounted merely because the user upgraded from an older workspace.
    applyWorkspacePanelRenderers(api, panels);
    applyWorkspacePanelConstraints(api, panels, widthConstraintsEnabled);
    return true;
  } catch {
    clearWorkspaceLayout(localStorage);
    return false;
  }
};

const DocumentHost: React.FC<{
  documents: LightTableWorkspaceDocument[];
  activeDocumentId: string;
  onActiveDocumentChange?: (documentId: string) => void;
  onSurfaceReady?: () => void;
}> = ({ documents, activeDocumentId, onActiveDocumentChange, onSurfaceReady }) => {
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0];

  useLayoutEffect(() => {
    // Dockview creates panel contents after the parent editor effects have
    // already run. Notify the editor on the next frame, when the document and
    // sibling scope canvases have all committed their refs.
    const frame = window.requestAnimationFrame(() => onSurfaceReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [onSurfaceReady]);

  return (
    <section className="lighttable-document-host">
      <div className="lighttable-document-tabs" role="tablist" aria-label="Open LightTable documents">
        {documents.map((document) => {
          const active = document.id === activeDocument?.id;
          return (
            <div
              key={document.id}
              className={`lighttable-document-tab${active ? ' lighttable-document-tab--active' : ''}`}
              role="tab"
              aria-selected={active}
              onMouseEnter={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const preview = event.currentTarget.querySelector<HTMLElement>('.lighttable-document-tab__preview');
                if (!preview) return;
                preview.style.left = `${Math.round(bounds.left)}px`;
                preview.style.top = `${Math.round(bounds.bottom)}px`;
                // Dockview positions panels with transforms. A fixed descendant
                // therefore uses that transformed panel as its containing block,
                // not the viewport. Measure the actual result and remove that
                // container offset so the preview touches its tab exactly.
                const positioned = preview.getBoundingClientRect();
                preview.style.left = `${Math.round(bounds.left * 2 - positioned.left)}px`;
                preview.style.top = `${Math.round(bounds.bottom * 2 - positioned.top)}px`;
              }}
            >
              {document.thumbnailUrl && !active ? (
                <div className="lighttable-document-tab__preview" role="tooltip">
                  <img src={document.thumbnailUrl} alt="" />
                </div>
              ) : null}
              <button
                type="button"
                className="lighttable-document-tab__title"
                title={document.title}
                onClick={() => onActiveDocumentChange?.(document.id)}
              >
                {document.title}
                {document.dirty ? <span aria-label="Unsaved changes"> *</span> : null}
              </button>
              {document.onClose ? (
                <button
                  type="button"
                  className="lighttable-document-tab__close"
                  aria-label={`Close ${document.title}`}
                  title={`Close ${document.title}`}
                  onClick={document.onClose}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="lighttable-document-host__content">
        {activeDocument?.content ?? (
          <div className="lighttable-document-host__empty">No document open</div>
        )}
      </div>
    </section>
  );
};

export const LightTableDockWorkspace = forwardRef<
  LightTableDockWorkspaceHandle,
  LightTableDockWorkspaceProps
>(({
  canvasOnly = false,
  documents,
  activeDocumentId,
  panels,
  accessoryWidthConstraintsEnabled,
  onResizeInteractionChange,
  onActiveDocumentChange,
  onDocumentSurfaceReady
}, ref) => {
  const apiRef = useRef<DockviewApi | null>(null);
  const workspaceElementRef = useRef<HTMLDivElement | null>(null);
  const layoutListenerRef = useRef<{ dispose: () => void } | null>(null);
  const dropListenerRef = useRef<{ dispose: () => void } | null>(null);
  const dropOverlayListenerRef = useRef<{ dispose: () => void } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const workspacePresetRef = useRef<LightTableWorkspacePreset>('default');
  const resettingLayoutRef = useRef(false);
  const canvasOnlyMaximizedRef = useRef(false);
  const lastLayoutChangeAtRef = useRef(0);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const panelLayoutSignature = panels
    .map((panel) => [
      panel.id,
      panel.contentKey,
      panel.title,
      panel.defaultPosition.referencePanelId,
      panel.defaultPosition.direction,
      panel.initialWidth,
      panel.initialHeight,
      panel.minimumHeight,
      panel.defaultFloating?.width,
      panel.defaultFloating?.height,
      panel.defaultFloating?.xRatio,
      panel.defaultFloating?.yRatio,
      panel.initiallyInactive,
      panel.requiredForSavedLayout
    ].join(':'))
    .join('|');
  const [ready, setReady] = useState(false);

  const saveLayout = useCallback(() => {
    lastLayoutChangeAtRef.current = performance.now();
    if (saveTimerRef.current !== null) return;

    const persistWhenSettled = () => {
      const remaining = 150 - (performance.now() - lastLayoutChangeAtRef.current);
      if (remaining > 0) {
        saveTimerRef.current = window.setTimeout(persistWhenSettled, remaining);
        return;
      }
      saveTimerRef.current = null;
      const api = apiRef.current;
      if (!api) return;
      try {
        persistWorkspaceLayout(localStorage, api.toJSON(), workspacePresetRef.current);
      } catch {
        // A workspace remains usable when browser storage is unavailable.
      }
    };

    saveTimerRef.current = window.setTimeout(persistWhenSettled, 150);
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    const saved = readWorkspaceLayout(localStorage);
    workspacePresetRef.current = saved?.preset ?? 'default';
    if (!restoreLayout(
      event.api,
      panelsRef.current,
      accessoryWidthConstraintsEnabled,
      saved?.layout
    )) {
      createDefaultLayout(event.api, panelsRef.current, accessoryWidthConstraintsEnabled);
    }
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = event.api.onDidLayoutChange(() => {
      if (resettingLayoutRef.current) return;
      workspacePresetRef.current = 'custom';
      saveLayout();
    });
    dropListenerRef.current?.dispose();
    dropOverlayListenerRef.current?.dispose();
    dropOverlayListenerRef.current = event.api.onWillShowOverlay((overlayEvent) => {
      if (!allowsWorkspaceDockTarget(
        workspaceElementRef.current,
        overlayEvent.kind,
        overlayEvent.position,
        overlayEvent.group,
        overlayEvent.nativeEvent.clientX
      )) overlayEvent.preventDefault();
    });
    dropListenerRef.current = event.api.onWillDrop((dropEvent) => {
      const transfer = dropEvent.getData();
      if (!transfer || transfer.viewId !== event.api.id) return;
      if (transfer.panelId === DOCUMENT_HOST_PANEL_ID) return;
      if (!allowsWorkspaceDockTarget(
        workspaceElementRef.current,
        dropEvent.kind,
        dropEvent.position,
        dropEvent.group,
        dropEvent.nativeEvent.clientX
      )) {
        dropEvent.preventDefault();
        return;
      }

      const targetIsDocument = dropEvent.group?.panels.some(
        (panel) => panel.id === DOCUMENT_HOST_PANEL_ID
      );
      const sourceGroup = transfer.groupId ? event.api.getGroup(transfer.groupId) : undefined;
      const item = transfer.panelId
        ? event.api.getPanel(transfer.panelId)
        : sourceGroup?.activePanel;
      const draggedDockItem = transfer.panelId ? item : sourceGroup;
      if (transfer.panelId && !item) return;

      // Dockview normally lets the top content split-zone start immediately
      // below the tab bar. That makes combining panels as tabs unnecessarily
      // precise: missing the bar by one pixel creates a new row. Extend the
      // tab target slightly into the content, while keeping the rest of the
      // top split-zone available for deliberate vertical splits.
      if (
        !targetIsDocument &&
        dropEvent.kind === 'content' &&
        dropEvent.position === 'top' &&
        dropEvent.group &&
        sourceGroup &&
        sourceGroup.id !== dropEvent.group.id &&
        !transfer.tabGroupId
      ) {
        const workspaceElement = workspaceElementRef.current;
        const targetBounds = dropEvent.group.api.boundingBox;
        if (workspaceElement && targetBounds) {
          const workspaceBounds = workspaceElement.getBoundingClientRect();
          const pointerY = dropEvent.nativeEvent.clientY - workspaceBounds.top;
          const mergeBoundary =
            targetBounds.top + PANEL_TAB_BAR_HEIGHT + TAB_MERGE_PRIORITY_EXTENSION;

          if (pointerY <= mergeBoundary) {
            const targetGroup = dropEvent.group;
            dropEvent.preventDefault();
            window.queueMicrotask(() => {
              if (apiRef.current !== event.api) return;
              if (transfer.panelId) {
                item?.api.moveTo({ group: targetGroup, position: 'center' });
              } else {
                sourceGroup.api.moveTo({ group: targetGroup, position: 'center' });
              }
            });
            return;
          }
        }
      }

      if (
        !targetIsDocument ||
        dropEvent.kind !== 'content' ||
        dropEvent.position !== 'center'
      ) {
        return;
      }

      // A normal tab drag supplies panelId. Dragging a floating titlebar or a
      // complete single-panel group supplies only groupId; handle both so a
      // group can never silently merge into the headerless document host.
      const workspaceElement = workspaceElementRef.current;
      if (
        !item
        || !draggedDockItem
        || item.id === DOCUMENT_HOST_PANEL_ID
        || !workspaceElement
      ) return;

      dropEvent.preventDefault();
      const rootBounds = workspaceElement.getBoundingClientRect();
      const width = Math.min(
        Math.max(item.group.api.width || 320, 250),
        ACCESSORY_PANEL_MAXIMUM_WIDTH,
        Math.max(250, rootBounds.width - 24)
      );
      // Docked columns are normally workspace-height. Starting a floating
      // panel at that same height makes it awkward to grab and resize.
      const height = Math.min(
        Math.max(Math.round(rootBounds.height * 0.6), 240),
        Math.max(240, rootBounds.height - 24)
      );
      const relativeX = dropEvent.nativeEvent.clientX - rootBounds.left;
      const relativeY = dropEvent.nativeEvent.clientY - rootBounds.top;
      const x = Math.max(0, Math.min(relativeX - 40, rootBounds.width - width));
      const y = Math.max(0, Math.min(relativeY - 15, rootBounds.height - height));

      // Cancel Dockview's normal centre docking. Mutate the layout after the
      // current drop handler has unwound so the source group remains valid.
      window.queueMicrotask(() => {
        if (apiRef.current !== event.api) return;
        // A tab drag floats one panel; dragging the empty tabbar floats the
        // complete group so tabs such as Layers + Scopes stay together.
        event.api.addFloatingGroup(
          draggedDockItem as Parameters<DockviewApi['addFloatingGroup']>[0],
          { x, y, width, height }
        );
      });
    });
    setReady(true);
  }, [accessoryWidthConstraintsEnabled, saveLayout]);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    resettingLayoutRef.current = true;
    workspacePresetRef.current = 'default';
    clearWorkspaceLayout(localStorage);
    api.clear();
    createDefaultLayout(api, panelsRef.current, accessoryWidthConstraintsEnabled);
    saveLayout();
    window.queueMicrotask(() => { resettingLayoutRef.current = false; });
  }, [accessoryWidthConstraintsEnabled, saveLayout]);

  const showPanel = useCallback((panelId: string) => {
    apiRef.current?.getPanel(panelId)?.api.setActive();
  }, []);

  useImperativeHandle(ref, () => ({ resetLayout, showPanel }), [resetLayout, showPanel]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = null;
    dropListenerRef.current?.dispose();
    dropListenerRef.current = null;
    dropOverlayListenerRef.current?.dispose();
    dropOverlayListenerRef.current = null;
    apiRef.current = null;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const api = apiRef.current;
    if (!api) return;
    applyWorkspacePanelConstraints(api, panelsRef.current, accessoryWidthConstraintsEnabled);
    synchronizeWorkspacePanelTitles(api, panelsRef.current);
    applyWorkspacePanelRenderers(api, panelsRef.current);
    const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (documentHost) {
      documentHost.group.header.hidden = true;
      documentHost.group.locked = false;
    }
  }, [accessoryWidthConstraintsEnabled, panelLayoutSignature, ready]);

  useLayoutEffect(() => {
    if (!ready) return;
    const api = apiRef.current;
    const documentHost = api?.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (!api || !documentHost) return;

    resettingLayoutRef.current = true;
    if (canvasOnly) {
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      api.maximizeGroup(documentHost);
      canvasOnlyMaximizedRef.current = true;
    } else if (canvasOnlyMaximizedRef.current) {
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      canvasOnlyMaximizedRef.current = false;
    }
    window.queueMicrotask(() => {
      resettingLayoutRef.current = false;
    });
  }, [canvasOnly, ready]);

  useEffect(() => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement) return;
    let resizing = false;
    let floatingResizeCleanup: (() => void) | null = null;

    const finishResize = () => {
      if (!resizing) return;
      resizing = false;
      floatingResizeCleanup?.();
      floatingResizeCleanup = null;
      onResizeInteractionChange?.(false);
      document.removeEventListener('pointerup', finishResize, true);
      document.removeEventListener('pointercancel', finishResize, true);
      document.removeEventListener('contextmenu', finishResize, true);
    };

    const startResize = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const resizeHandle = target.closest('.dv-sash, [class*="dv-resize-handle-"]');
      if (!resizeHandle || !workspaceElement.contains(resizeHandle)) return;
      if (resizing) return;
      resizing = true;
      onResizeInteractionChange?.(true);

      const floatingFrame = resizeHandle.closest<HTMLElement>('.dv-resize-container');
      if (floatingFrame) {
        const direction = Array.from(resizeHandle.classList)
          .find((className) => className.startsWith('dv-resize-handle-'))
          ?.slice('dv-resize-handle-'.length);
        const workspaceBounds = workspaceElement.getBoundingClientRect();
        const frameBounds = floatingFrame.getBoundingClientRect();
        const fixedLeft = frameBounds.left - workspaceBounds.left;
        const fixedRight = workspaceBounds.right - frameBounds.right;
        const fixedTop = frameBounds.top - workspaceBounds.top;
        const fixedBottom = workspaceBounds.bottom - frameBounds.bottom;

        const lockStyle = (property: string, value: string) => {
          if (
            floatingFrame.style.getPropertyValue(property) === value
            && floatingFrame.style.getPropertyPriority(property) === 'important'
          ) return;
          floatingFrame.style.setProperty(property, value, 'important');
        };

        const maintainOppositeEdge = () => {
          if (direction?.includes('right')) {
            lockStyle('left', `${fixedLeft}px`);
            lockStyle('right', 'auto');
          } else if (direction?.includes('left')) {
            lockStyle('right', `${fixedRight}px`);
            lockStyle('left', 'auto');
          }
          if (direction?.includes('bottom')) {
            lockStyle('top', `${fixedTop}px`);
            lockStyle('bottom', 'auto');
          } else if (direction?.includes('top')) {
            lockStyle('bottom', `${fixedBottom}px`);
            lockStyle('top', 'auto');
          }
        };

        maintainOppositeEdge();
        const observer = new MutationObserver(maintainOppositeEdge);
        observer.observe(floatingFrame, { attributes: true, attributeFilter: ['style'] });
        floatingResizeCleanup = () => {
          observer.disconnect();
          normalizeFloatingFrameBounds(apiRef.current, floatingFrame, workspaceElement);
        };
      }

      document.addEventListener('pointerup', finishResize, true);
      document.addEventListener('pointercancel', finishResize, true);
      document.addEventListener('contextmenu', finishResize, true);
    };

    /*
     * Capture is intentional: Dockview may stop propagation from a sash or
     * floating resize handle. The callback must therefore remain imperative
     * and must not synchronously update React state; doing that here can
     * replace Dockview nodes before its pointerdown handler installs capture.
     */
    workspaceElement.addEventListener('pointerdown', startResize, true);
    return () => {
      workspaceElement.removeEventListener('pointerdown', startResize, true);
      document.removeEventListener('pointerup', finishResize, true);
      document.removeEventListener('pointercancel', finishResize, true);
      document.removeEventListener('contextmenu', finishResize, true);
      floatingResizeCleanup?.();
      floatingResizeCleanup = null;
      if (resizing) onResizeInteractionChange?.(false);
    };
  }, [onResizeInteractionChange]);

  const content = useMemo<WorkspaceContent>(() => {
    const registeredContent = Object.fromEntries(
      panels.map((panel) => [panel.contentKey, panel.content])
    ) as WorkspaceContent;
    registeredContent.documentHost = (
      <DocumentHost
        documents={documents}
        activeDocumentId={activeDocumentId}
        onActiveDocumentChange={onActiveDocumentChange}
        onSurfaceReady={onDocumentSurfaceReady}
      />
    );
    return registeredContent;
  }, [activeDocumentId, documents, onActiveDocumentChange, onDocumentSurfaceReady, panels]);

  const components = useMemo(() => ({ workspacePanel: WorkspacePanel }), []);
  const tabComponents = useMemo(() => ({ persistentPanelTab: PersistentPanelTab }), []);

  return (
    <WorkspaceContentContext.Provider value={content}>
      <div
        ref={workspaceElementRef}
        className={`lighttable-dock-workspace dockview-theme-dark${canvasOnly ? ' lighttable-dock-workspace--canvas-only' : ''}${accessoryWidthConstraintsEnabled ? ' lighttable-dock-workspace--accessory-width-constrained' : ''}`}
      >
        <DockviewReact
          components={components}
          tabComponents={tabComponents}
          onReady={onReady}
          dndEdges={{
            activationSize: { value: SIDE_DOCK_ACTIVATION_DISTANCE, type: 'pixels' },
            size: { value: SIDE_DOCK_ACTIVATION_DISTANCE, type: 'pixels' }
          }}
          floatingGroupBounds="boundedWithinViewport"
          // Reuse the empty area to the right of the tabs as the floating
          // window handle. This keeps the header to a single row: dragging a
          // tab redocks that panel, while the empty tabbar moves the float
          // (Shift+drag redocks the complete floating group).
          floatingGroupDragHandle="tabbar"
        />
      </div>
    </WorkspaceContentContext.Provider>
  );
});

LightTableDockWorkspace.displayName = 'LightTableDockWorkspace';
