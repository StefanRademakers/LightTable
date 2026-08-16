import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormSelect } from './FormSelect';

describe('FormSelect', () => {
  it('owns the canonical dropdown class and runtime identity', () => {
    const markup = renderToStaticMarkup(
      <FormSelect aria-label="Mode" className="feature-select" defaultValue="normal">
        <option value="normal">Normal</option>
      </FormSelect>
    );
    expect(markup).toContain('class="form-input feature-select"');
    expect(markup).toContain('data-suite-control="form-select"');
  });
});
