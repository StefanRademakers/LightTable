import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ButtonBase } from './ButtonBase';

describe('ButtonBase', () => {
  it('preserves a product surface while exposing its provisional audit status', () => {
    const markup = renderToStaticMarkup(
      <ButtonBase className="layer-row-action">Open</ButtonBase>
    );
    expect(markup).toContain('class="layer-row-action"');
    expect(markup).toContain('data-suite-control="button-base"');
    expect(markup).toContain('data-suite-status="provisional"');
  });
});
