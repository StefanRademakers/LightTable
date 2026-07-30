import { describe, expect, it } from 'vitest';
import { createEditorSession } from './editorSession';

describe('LightTable editor session', () => {
  it('starts the shared paint and erase brush at five percent spacing', () => {
    expect(createEditorSession().brush.spacing).toBe(0.05);
  });
});
