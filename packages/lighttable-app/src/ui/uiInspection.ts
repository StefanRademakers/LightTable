export interface UiInspectionTarget {
  readonly controlId: string | null;
  readonly label: string;
  readonly element: string;
  readonly status: string | null;
  readonly className: string;
  readonly context: string;
}

export const OPEN_UI_STYLE_GUIDE_EVENT = 'lighttable:open-ui-style-guide';

export const requestUiStyleGuide = (): void => {
  window.dispatchEvent(new CustomEvent(OPEN_UI_STYLE_GUIDE_EVENT));
};

type InspectionGesture = Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

export const isUiInspectionGesture = (event: InspectionGesture): boolean =>
  event.altKey && event.shiftKey && (event.ctrlKey || event.metaKey);

const readableText = (element: HTMLElement): string => {
  const explicit = element.getAttribute('aria-label') || element.getAttribute('title');
  if (explicit) return explicit;
  const childLabels = [...element.querySelectorAll<HTMLElement>(
    ':scope > [role="tab"], :scope > [role="menuitem"], :scope > [role="option"]'
  )].slice(0, 5).map((child) =>
    child.getAttribute('aria-label') || child.textContent?.trim().replaceAll(/\s+/g, ' ')
  ).filter(Boolean);
  if (childLabels.length) return childLabels.join(' / ');
  return element.textContent?.trim().replaceAll(/\s+/g, ' ').slice(0, 80) || 'Unnamed control';
};

const readableContext = (element: HTMLElement): string => {
  const owner = element.parentElement?.closest<HTMLElement>(
    '[aria-label], [role="dialog"], section, aside, nav, header, footer'
  );
  return owner?.getAttribute('aria-label')
    || owner?.querySelector<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4')?.textContent?.trim()
    || owner?.className?.toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    || 'Application surface';
};

export const describeUiInspectionTarget = (target: EventTarget | null): UiInspectionTarget | null => {
  if (!(target instanceof Element)) return null;
  const registered = target.closest<HTMLElement>('[data-suite-control]');
  const element = registered ?? target.closest<HTMLElement>(
    'button, select, input:not([type="hidden"]), [role="button"], [role="slider"], [role="menuitem"], [role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="tablist"]'
  );
  if (!element || element.closest('[data-ui-inspector], .lighttable-ui-guide')) return null;
  return {
    controlId: registered?.dataset.suiteControl || null,
    label: readableText(element),
    element: element.tagName.toLowerCase(),
    status: registered?.dataset.suiteStatus || null,
    className: element.className?.toString().trim() || '',
    context: readableContext(element)
  };
};
