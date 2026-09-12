import { describe, expect, it } from 'vitest';
import { projectRetainedImagePropertiesView } from './retainedImagePropertiesView';

describe('projectRetainedImagePropertiesView', () => {
  it('retains the last image editor while a typed document placeholder is visible', () => {
    const retained = { current: 'empty' as const };

    expect(projectRetainedImagePropertiesView(retained, 'image', 'grade')).toBe('grade');
    expect(projectRetainedImagePropertiesView(retained, 'video', 'empty')).toBe('grade');
    expect(projectRetainedImagePropertiesView(retained, 'model-3d', 'empty')).toBe('grade');
    expect(projectRetainedImagePropertiesView(retained, 'image', 'text')).toBe('text');
  });
});
