import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select } from '@lighttable/ui';

describe('Select', () => {
  it('owns the canonical dropdown class and runtime identity', () => {
    const markup = renderToStaticMarkup(
      <Select aria-label="Mode" className="feature-select" defaultValue="normal">
        <option value="normal">Normal</option>
      </Select>
    );
    expect(markup).toContain('class="ui-select feature-select"');
    expect(markup).toContain('data-suite-control="form-select"');
  });
});
