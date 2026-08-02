import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { ToolId } from '../session/editorSession';
import {
  SELECTION_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  type ToolDefinition
} from '../tools/toolRegistry';

interface EditorToolbarProps {
  activeTool: ToolId;
  foregroundColor: string;
  backgroundColor: string;
  onToolChange: (tool: ToolId) => void;
  onForegroundColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  activeTool,
  foregroundColor,
  backgroundColor,
  onToolChange,
  onForegroundColorChange,
  onBackgroundColorChange,
  onSwapColors,
  onResetColors
}) => {
  const activeSelection = SELECTION_TOOL_DEFINITIONS.find(({ id }) => id === activeTool);
  const [selectionMaster, setSelectionMaster] = React.useState<ToolDefinition>(
    activeSelection ?? SELECTION_TOOL_DEFINITIONS[0]!
  );
  const [selectionMenuOpen, setSelectionMenuOpen] = React.useState(false);
  const [selectionMenuGeneration, setSelectionMenuGeneration] = React.useState(0);

  React.useEffect(() => {
    if (activeSelection) setSelectionMaster(activeSelection);
  }, [activeSelection]);

  React.useEffect(() => {
    if (!selectionMenuOpen) return undefined;
    const timeout = window.setTimeout(() => setSelectionMenuOpen(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [selectionMenuGeneration, selectionMenuOpen]);

  const selectionMasterTool = activeSelection ?? selectionMaster;

  const toolButton = (tool: ToolDefinition, selectionActive = false) => (
    <button
      key={tool.id}
      type="button"
      className={`lighttable-toolbox__button${activeTool === tool.id || selectionActive ? ' lighttable-toolbox__button--active' : ''}`}
      onClick={() => onToolChange(tool.id)}
      aria-pressed={activeTool === tool.id}
      aria-label={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
      title={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
    >
      <img src={lightTableIcon(tool.iconName)} alt="" aria-hidden="true" />
    </button>
  );

  return (
    <nav className="lighttable-toolbox" aria-label="Image tools">
      <div className="lighttable-toolbox__content">
        {TOOL_DEFINITIONS.map((tool) => {
          if (tool.role === 'selection' && tool.id !== SELECTION_TOOL_DEFINITIONS[0]?.id) {
            return null;
          }
          if (tool.role !== 'selection') return toolButton(tool);
          return (
            <div
              key="selection-tools"
              className="lighttable-toolbox__group"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setSelectionMenuOpen(false);
                }
              }}
            >
              {toolButton(selectionMasterTool, Boolean(activeSelection))}
              <button
                type="button"
                className="lighttable-toolbox__group-menu-button"
                aria-label="Show selection tools"
                aria-haspopup="true"
                aria-expanded={selectionMenuOpen}
                title="Show selection tools"
                onClick={() => {
                  setSelectionMenuOpen(true);
                  setSelectionMenuGeneration((generation) => generation + 1);
                }}
              ><span aria-hidden="true" /></button>
              {selectionMenuOpen ? (
                <div className="lighttable-toolbox__flyout" role="toolbar" aria-label="Selection tools">
                  {SELECTION_TOOL_DEFINITIONS.map((selectionTool) => (
                    <button
                      key={selectionTool.id}
                      type="button"
                      className={`lighttable-toolbox__button${activeTool === selectionTool.id ? ' lighttable-toolbox__button--active' : ''}`}
                      onClick={() => {
                        setSelectionMaster(selectionTool);
                        setSelectionMenuOpen(false);
                        onToolChange(selectionTool.id);
                      }}
                      aria-pressed={activeTool === selectionTool.id}
                      aria-label={selectionTool.shortcutLabel
                        ? `${selectionTool.label} (${selectionTool.shortcutLabel})`
                        : selectionTool.label}
                      title={selectionTool.shortcutLabel
                        ? `${selectionTool.label} (${selectionTool.shortcutLabel})`
                        : selectionTool.label}
                    >
                      <img src={lightTableIcon(selectionTool.iconName)} alt="" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="lighttable-toolbox__colors" aria-label="Foreground and background colors">
          <button
            type="button"
            className="lighttable-toolbox__reset-colors"
            onClick={onResetColors}
            title="Reset foreground and background colors"
            aria-label="Reset foreground and background colors"
          >
            <span />
            <span />
          </button>
          <button
            type="button"
            className="lighttable-toolbox__swap-colors"
            onClick={onSwapColors}
            title="Swap foreground and background colors (X)"
            aria-label="Swap foreground and background colors"
          >
            ↔
          </button>
          <label
            className="lighttable-toolbox__color lighttable-toolbox__color--background"
            style={{ backgroundColor }}
            title="Background color"
          >
            <input
              type="color"
              value={backgroundColor}
              onChange={(event) => onBackgroundColorChange(event.currentTarget.value)}
              aria-label="Background color"
            />
          </label>
          <label
            className="lighttable-toolbox__color lighttable-toolbox__color--foreground"
            style={{ backgroundColor: foregroundColor }}
            title="Foreground color"
          >
            <input
              type="color"
              value={foregroundColor}
              onChange={(event) => onForegroundColorChange(event.currentTarget.value)}
              aria-label="Foreground color"
            />
          </label>
        </div>
      </div>
    </nav>
  );
};
