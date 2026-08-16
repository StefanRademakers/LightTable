import { describe, expect, it } from 'vitest';
import { UI_STYLE_GUIDE_CATEGORIES } from './UiStyleGuideDialog';
import usageInventory from '../ui/generatedUiUsageInventory.json';

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
      'Coverage & usage',
      'Feedback',
      'Adjustment dialogs',
      'Dialogs'
    ]);
  });

  it('keeps every catalogued control identifiable in the running suite UI', () => {
    expect(usageInventory.components).toHaveLength(25);
    expect(usageInventory.components.every(({ metadataDeclared }) => metadataDeclared)).toBe(true);
  });
});
