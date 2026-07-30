import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { ToolId } from '../session/editorSession';
import { TOOL_DEFINITIONS } from '../tools/toolRegistry';

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
}) => (
  <nav className="lighttable-toolbox" aria-label="Image tools">
    <div className="lighttable-toolbox__content">
      {TOOL_DEFINITIONS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`lighttable-toolbox__button${activeTool === tool.id ? ' lighttable-toolbox__button--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          aria-pressed={activeTool === tool.id}
          aria-label={`${tool.label} (${tool.shortcutLabel})`}
          title={`${tool.label} (${tool.shortcutLabel})`}
        >
          <img src={lightTableIcon(tool.iconName)} alt="" aria-hidden="true" />
        </button>
      ))}
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
