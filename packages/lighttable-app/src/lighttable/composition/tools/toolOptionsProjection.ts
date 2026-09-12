import type { ToolOptionsFeatureProjection, ToolOptionsProps } from '../../editor/ui/ToolOptionsBar';

/** UI surface differences only; all tool state and commands retain their original owners. */
export const projectToolOptions = (
  shared: ToolOptionsFeatureProjection,
  gradientEditorRequest: ToolOptionsProps['gradientEditorRequest'],
  closeContextMenu: () => void
) => ({
  toolbar: { ...shared, gradientEditorRequest },
  contextMenu: {
    ...shared,
    onWarpReset: () => {
      shared.onWarpReset();
      closeContextMenu();
    },
    onClose: closeContextMenu
  }
});
