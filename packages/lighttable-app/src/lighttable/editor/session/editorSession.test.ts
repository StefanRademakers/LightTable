import { describe, expect, it } from 'vitest';
import { createEditorSession } from './editorSession';

describe('LightTable editor session', () => {
  it('starts the shared paint and erase brush at five percent spacing', () => {
    expect(createEditorSession().brush.spacing).toBe(0.05);
  });

  it('keeps Warp settings document-scoped and source-pixel based', () => {
    expect(createEditorSession().warp).toMatchObject({
      mode: 'push',
      diameterPx: 200,
      strength: 0.35,
      spacing: 0.1,
      pressureSize: true,
      pressureStrength: true
    });
  });
});
