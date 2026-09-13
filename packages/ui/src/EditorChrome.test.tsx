import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EditorChrome,
  EditorChromeBody,
  EditorChromeHeader,
  EditorStatusBar,
  EditorStatusMeta,
  EditorStatusText,
  EditorToolOptionsBar
} from './EditorChrome';

describe('EditorChrome', () => {
  it('publishes generic suite ownership without imposing product state', () => {
    const markup = renderToStaticMarkup(
      <EditorChrome className="host-editor">
        <EditorChromeHeader>Menu</EditorChromeHeader>
        <EditorToolOptionsBar>Options</EditorToolOptionsBar>
        <EditorChromeBody>Workspace</EditorChromeBody>
      </EditorChrome>
    );
    expect(markup).toContain('data-suite-control="editor-chrome"');
    expect(markup).toContain('class="ui-editor-chrome host-editor"');
    expect(markup).toContain('data-suite-control="editor-tool-options"');
  });

  it('keeps status meaning in explicit slots', () => {
    const markup = renderToStaticMarkup(
      <EditorStatusBar>
        <EditorStatusText tone="error">Failed</EditorStatusText>
        <EditorStatusMeta interactive>Report</EditorStatusMeta>
      </EditorStatusBar>
    );
    expect(markup).toContain('data-suite-control="editor-status-bar"');
    expect(markup).toContain('data-tone="error"');
    expect(markup).toContain('data-interactive="true"');
  });
});
