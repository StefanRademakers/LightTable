import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '@lighttable/ui';

describe('SegmentedControl', () => {
  it('projects workspace choices through the package with app-owned icons', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        label="Workspace"
        value="grading"
        onChange={vi.fn()}
        options={[
          { value: 'ai', label: 'Gen AI', icon: <svg aria-hidden="true" /> },
          { value: 'grading', label: 'Grading' }
        ]}
      />
    );

    expect(markup).toContain('class="ui-segmented"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('ui-segmented__icon');
    expect(markup).toContain('data-suite-control="segmented-control"');
    expect(markup).toContain('aria-checked="true"');
  });

  it('keeps the standard treatment as the default', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        label="Mode"
        value="new"
        onChange={vi.fn()}
        options={[{ value: 'new', label: 'New' }]}
      />
    );

    expect(markup).toContain('class="ui-segmented"');
    expect(markup).not.toContain('segmented-control--low-attention');
  });
});
