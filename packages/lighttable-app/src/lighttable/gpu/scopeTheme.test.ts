import { afterEach, expect, it, vi } from 'vitest';
import { observeScopeTheme, type ScopeTheme } from '@lighttable/ui/scopeRendering';

afterEach(() => vi.unstubAllGlobals());

it('observes the document theme even before docking and releases both observers', () => {
  let resized = () => {};
  let themeChanged = () => {};
  const observe = vi.fn();
  const disconnected = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { themeChanged = callback; }
    observe = observe;
    disconnect = disconnected;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnected;
  });
  const root = {};
  let theme: string | null = null;
  let background = 'rgb(28, 33, 39)';
  const canvas = {
    ownerDocument: { documentElement: root },
    closest: () => theme ? { getAttribute: () => theme } : null
  } as unknown as HTMLElement;
  vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: background, getPropertyValue: () => '#ff424c' }));
  const updates: ScopeTheme[] = [];
  const stop = observeScopeTheme(canvas, value => updates.push(value));
  expect(observe).toHaveBeenCalledWith(root, { subtree: true, attributes: true, attributeFilter: ['data-ui-theme'] });
  theme = 'light'; background = 'rgb(255, 255, 255)'; resized();
  expect(updates.at(-1)).toMatchObject({ light: true, background: [1, 1, 1] });
  theme = 'dark'; background = 'rgb(28, 33, 39)'; themeChanged();
  expect(updates.at(-1)).toMatchObject({ light: false, background: [28 / 255, 33 / 255, 39 / 255] });
  stop();
  expect(disconnected).toHaveBeenCalledTimes(2);
});
