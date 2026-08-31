export interface ScopeTheme {
  light: boolean;
  backgroundCss: string;
  background: [number, number, number];
  channels: [string, string, string];
}

/** Read styles only when the theme changes, never in the analysis/render loop. */
export function observeScopeTheme(element: HTMLElement, onChange: (theme: ScopeTheme) => void): () => void {
  const update = () => {
    const style = getComputedStyle(element);
    const backgroundCss = style.backgroundColor;
    const rgb = backgroundCss.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    onChange({
      light: element.closest('[data-ui-theme]')?.getAttribute('data-ui-theme') === 'light',
      backgroundCss,
      background: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
      channels: ['red', 'green', 'blue'].map(channel => style.getPropertyValue(`--ui-scope-${channel}`).trim()) as ScopeTheme['channels']
    });
  };
  update();
  const observer = new MutationObserver(update);
  // Docking hosts may mount in a detached container, then reparent it. Watching
  // only the initial ancestors misses both the document theme and later scopes.
  observer.observe(element.ownerDocument.documentElement, {
    subtree: true, attributes: true, attributeFilter: ['data-ui-theme']
  });
  const resize = new ResizeObserver(update);
  resize.observe(element);
  return () => { observer.disconnect(); resize.disconnect(); };
}
