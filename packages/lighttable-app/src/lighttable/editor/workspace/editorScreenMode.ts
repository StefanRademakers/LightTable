export type EditorScreenMode = 'normal' | 'fullscreen' | 'canvas-only';

/** F-key cycle: window fullscreen first, then distraction-free canvas. */
export const nextEditorScreenMode = (
  current: EditorScreenMode
): EditorScreenMode => {
  switch (current) {
    case 'normal':
      return 'fullscreen';
    case 'fullscreen':
      return 'canvas-only';
    case 'canvas-only':
      return 'normal';
  }
};

export const screenModeUsesHostFullscreen = (mode: EditorScreenMode) =>
  mode !== 'normal';
