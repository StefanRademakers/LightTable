import { describe, expect, it } from 'vitest';
import {
  nextEditorScreenMode,
  screenModeUsesHostFullscreen
} from './editorScreenMode';

describe('editor screen mode', () => {
  it('enters window fullscreen before hiding editor chrome', () => {
    expect(nextEditorScreenMode('normal')).toBe('fullscreen');
    expect(nextEditorScreenMode('fullscreen')).toBe('canvas-only');
    expect(nextEditorScreenMode('canvas-only')).toBe('normal');
  });

  it('keeps the host fullscreen for both expanded modes', () => {
    expect(screenModeUsesHostFullscreen('normal')).toBe(false);
    expect(screenModeUsesHostFullscreen('fullscreen')).toBe(true);
    expect(screenModeUsesHostFullscreen('canvas-only')).toBe(true);
  });
});
