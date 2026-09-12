import { describe, expect, it, vi } from 'vitest';
import { DockviewGroupPanelModel } from 'dockview-core';
import { workspacePanelIsShown } from './workspacePanelIsShown';

describe('workspace panel reveal admission', () => {
  it.each([true, false])('already shown controls need no reveal when the group active flag is %s', isActive => {
    const panel = { id: 'properties', group: {
      api: { isVisible: true, isActive }, activePanel: { id: 'properties' }
    } };
    expect(workspacePanelIsShown(panel)).toBe(true);
  });

  it('preserves reveal/create for hidden groups, background tabs and absent panels', () => {
    expect(workspacePanelIsShown({ id: 'properties', group: {
      api: { isVisible: false }, activePanel: { id: 'properties' }
    } })).toBe(false);
    expect(workspacePanelIsShown({ id: 'properties', group: {
      api: { isVisible: true }, activePanel: { id: 'assets' }
    } })).toBe(false);
    expect(workspacePanelIsShown(undefined)).toBe(false);
  });

  it('avoids the installed Dockview active-panel reattachment path', () => {
    // Exercise the actual dependency's activation branch without claiming a
    // browser DOM/focus test; the desktop smoke checks real input focus.
    const renderPanel = vi.fn(), panel = { id: 'properties', updateParentGroup: vi.fn() };
    const model = { panels: [panel], _activePanel: panel, groupPanel: {},
      doAddPanel: vi.fn(), contentContainer: { renderPanel } };
    const activate = () => DockviewGroupPanelModel.prototype.openPanel.call(
      model as unknown as DockviewGroupPanelModel, panel as never);
    activate();
    expect(renderPanel).toHaveBeenCalledExactlyOnceWith(panel, { asActive: true });
    renderPanel.mockClear();
    const presented = { ...panel, group: { api: { isVisible: true }, activePanel: panel } };
    if (!workspacePanelIsShown(presented)) activate();
    expect(renderPanel).not.toHaveBeenCalled();
  });
});
