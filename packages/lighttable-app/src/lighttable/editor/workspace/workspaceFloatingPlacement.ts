export interface WorkspaceFloatingPlacementInput {
  readonly workspaceWidth: number;
  readonly workspaceHeight: number;
  readonly requestedWidth: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
}

export interface WorkspaceFloatingPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One geometry authority for both the visible drop preview and final float. */
export const calculateWorkspaceFloatingPlacement = ({
  workspaceWidth,
  workspaceHeight,
  requestedWidth,
  pointerX,
  pointerY,
  minimumWidth,
  maximumWidth
}: WorkspaceFloatingPlacementInput): WorkspaceFloatingPlacement => {
  const width = Math.min(
    Math.max(requestedWidth || 320, minimumWidth),
    maximumWidth,
    Math.max(minimumWidth, workspaceWidth - 24)
  );
  const height = Math.min(
    Math.max(Math.round(workspaceHeight * 0.6), 240),
    Math.max(240, workspaceHeight - 24)
  );

  return {
    x: Math.max(0, Math.min(pointerX - 40, workspaceWidth - width)),
    y: Math.max(0, Math.min(pointerY - 15, workspaceHeight - height)),
    width,
    height
  };
};
