import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { ToolId } from '../session/editorSession';

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

const TOOLS: Array<{ id: ToolId; label: string; shortcut: string; icon: string }> = [
  { id: 'transform', label: 'Transform', shortcut: 'T', icon: lightTableIcon('transform_tool.png') },
  { id: 'select-rectangle', label: 'Rectangular selection', shortcut: 'M', icon: lightTableIcon('select_rectangle.png') },
  { id: 'select-ellipse', label: 'Elliptical selection', shortcut: 'Shift+M', icon: lightTableIcon('select_elipse.png') },
  { id: 'select-free', label: 'Free selection', shortcut: 'L', icon: lightTableIcon('select_free_shape.png') },
  { id: 'fill', label: 'Fill', shortcut: 'G', icon: lightTableIcon('tool_fill_color.png') },
  { id: 'brush', label: 'Brush', shortcut: 'B', icon: lightTableIcon('paint_brush.png') },
  { id: 'erase', label: 'Erase', shortcut: 'E', icon: lightTableIcon('erase.png') },
  { id: 'view', label: 'Move canvas', shortcut: 'H', icon: lightTableIcon('move_canvas.png') }
];

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
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`lighttable-toolbox__button${activeTool === tool.id ? ' lighttable-toolbox__button--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          aria-pressed={activeTool === tool.id}
          aria-label={`${tool.label} (${tool.shortcut})`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          <img src={tool.icon} alt="" aria-hidden="true" />
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
