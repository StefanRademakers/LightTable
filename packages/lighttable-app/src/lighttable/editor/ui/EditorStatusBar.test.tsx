import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorStatusBar } from './EditorStatusBar';

describe('EditorStatusBar', () => {
  it('renders accessible primary workspace switches with the current preset selected', () => {
    const markup = renderToStaticMarkup(
      <EditorStatusBar
        status="Ready"
        error={false}
        meta="64 × 64"
        workspacePreset="grading"
        onWorkspacePresetChange={vi.fn()}
      />
    );

    expect(markup).toContain('aria-label="Workspaces"');
    expect(markup).toContain('ui-segmented lighttable-toolbar__workspace-switches');
    expect(markup).toContain('aria-label="Switch to Gen AI workspace"');
    expect(markup).toContain('aria-label="Switch to Grading workspace"');
    expect(markup).toContain('aria-checked="true" title="Grading workspace"');
    expect(markup).toContain('aria-label="Switch to Photo edit workspace"');
    expect(markup).toContain('aria-label="Switch to Video workspace"');
    expect(markup).toContain('genai.png');
    expect(markup).toContain('add_adjustment_layer.png');
    expect(markup).toContain('photo.png');
    expect(markup).toContain('media_video.png');
  });
});
