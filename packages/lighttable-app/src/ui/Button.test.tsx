import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@lighttable/ui';

describe('package Button', () => {
  it('uses one control for app, dialog, disabled and destructive actions', () => {
    const markup = renderToStaticMarkup(<>
      <Button>App action</Button>
      <Button tabIndex={0} type="submit">Dialog action</Button>
      <Button intent="destructive" disabled>Delete</Button>
      <Button fullWidth>Generate</Button>
    </>);
    expect(markup.match(/class="ui-button"/g)).toHaveLength(4);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('data-intent="destructive"');
    expect(markup).toContain('data-full-width="true"');
    expect(markup).toContain('data-suite-control="action-button"');
  });
});
