/** Showing an already presented panel must not reactivate/reparent its live controls. */
export const workspacePanelIsShown = (panel: {
  readonly id: string;
  readonly group: {
    readonly api: { readonly isVisible: boolean };
    readonly activePanel: { readonly id: string } | undefined;
  };
} | undefined): boolean => Boolean(panel && panel.group.api.isVisible
  && panel.group.activePanel?.id === panel.id);
