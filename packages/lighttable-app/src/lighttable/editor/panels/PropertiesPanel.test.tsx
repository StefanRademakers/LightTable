import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PropertiesPanel } from './PropertiesPanel';

const render = (view: React.ComponentProps<typeof PropertiesPanel>['view']) =>
  renderToStaticMarkup(
    <PropertiesPanel
      view={view}
      editors={{
        grade: <div>grade-editor</div>,
        curves: <div>curves-editor</div>,
        exposure: <div>exposure-editor</div>,
        vibrance: <div>vibrance-editor</div>,
        'gradient-map': <div>gradient-map-editor</div>,
        'lens-fx': <div>lens-editor</div>,
        effects: <div>effects-editor</div>,
        text: <div>text-editor</div>
      }}
    />
  );

describe('PropertiesPanel', () => {
  it.each([
    ['grade', 'grade-editor'],
    ['curves', 'curves-editor'],
    ['exposure', 'exposure-editor'],
    ['vibrance', 'vibrance-editor'],
    ['gradient-map', 'gradient-map-editor'],
    ['lens-fx', 'lens-editor'],
    ['effects', 'effects-editor'],
    ['text', 'text-editor']
  ] as const)('mounts only the %s editor', (view, expected) => {
    const markup = render(view);
    expect(markup).toContain(expected);
    expect(markup.match(/-editor/g)).toHaveLength(1);
  });

  it('shows a neutral empty state for unsupported layer content and masks', () => {
    expect(render('empty')).toContain('Select editable layer content');
  });
});
