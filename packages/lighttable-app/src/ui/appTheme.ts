export type AppTheme = 'light' | 'dark';
const storageKey = 'lighttable.ui.theme';

export const getAppTheme = (): AppTheme =>
  typeof document !== 'undefined' && document.documentElement.dataset.uiTheme === 'light' ? 'light' : 'dark';

export const setAppTheme = (theme: AppTheme): void => {
  document.documentElement.dataset.uiTheme = theme;
  try { localStorage.setItem(storageKey, theme); } catch { /* Optional preference storage. */ }
};

// One document scope also reaches portal-mounted dialogs and floating panels.
if (typeof document !== 'undefined') {
  let theme: AppTheme = 'dark';
  try { if (localStorage.getItem(storageKey) === 'light') theme = 'light'; } catch { /* Dark default. */ }
  document.documentElement.dataset.uiTheme = theme;
}
