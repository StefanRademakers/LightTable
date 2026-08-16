import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  it('projects the low-attention variant without changing radio semantics', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        variant="low-attention"
        ariaLabel="Workspace"
        value="grading"
        onChange={vi.fn()}
        options={[
          { value: 'ai', label: 'Gen AI' },
          { value: 'grading', label: 'Grading' }
        ]}
      />
    );

    expect(markup).toContain('segmented-control segmented-control--low-attention');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('data-suite-control="segmented-control"');
    expect(markup).toContain('aria-checked="true"');
  });

  it('keeps the standard treatment as the default', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="Mode"
        value="new"
        onChange={vi.fn()}
        options={[{ value: 'new', label: 'New' }]}
      />
    );

    expect(markup).toContain('class="segmented-control"');
    expect(markup).not.toContain('segmented-control--low-attention');
  });
});
