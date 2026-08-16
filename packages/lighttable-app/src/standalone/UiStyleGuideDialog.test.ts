import { describe, expect, it } from 'vitest';
import { UI_STYLE_GUIDE_CATEGORIES } from './UiStyleGuideDialog';

describe('UI Style Guide taxonomy', () => {
  it('keeps every canonical UI family directly inspectable', () => {
    expect(UI_STYLE_GUIDE_CATEGORIES.map(({ label }) => label)).toEqual([
      'Foundations',
      'Actions',
      'Fields',
      'Selection',
      'Sliders',
      'Paint & color',
      'Gradients',
      'Lists & navigation',
      'Containers',
      'Layout & geometry',
      'Feedback',
      'Adjustment dialogs',
      'Dialogs'
    ]);
  });
});
