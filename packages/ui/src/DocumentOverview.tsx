import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentTab } from './DocumentTabs';
import { IconButton } from './IconButton';
import { MaskIcon } from './MaskIcon';
import { closeIconUrl } from './icons';

export interface DocumentPreviewBounds { left: number; top: number; width: number; height: number }
export interface DocumentOverviewTarget {
  container: RefObject<HTMLElement | null>;
  getActiveBounds?: () => DocumentPreviewBounds | undefined;
}

/** Preview-only overview. Never captures pixels or mounts document renderers. */
export function DocumentOverview({ documents, activeId, target, onSelect, onDismiss }: {
  documents: readonly DocumentTab[]; activeId: string; target: DocumentOverviewTarget;
  onSelect: (id: string) => void; onDismiss: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const closing = useRef(false);
  const initialId = useRef(activeId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const source = useRef<DocumentPreviewBounds | undefined>(undefined);
  const callbacks = useRef({ onSelect, onDismiss });
  callbacks.current = { onSelect, onDismiss };
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const imageFor = (id: string) => Array.from(root.current?.querySelectorAll<HTMLImageElement>('img[data-document-id]') ?? [])
    .find(image => image.dataset.documentId === id);
  const expandedBounds = (image: HTMLImageElement, id: string): DocumentPreviewBounds => {
    if (id === initialId.current && source.current) return source.current;
    if (id === activeId) {
      const current = target.getActiveBounds?.();
      if (current) return current;
    }
    const bounds = target.container.current!.getBoundingClientRect();
    const ratio = image.naturalWidth / image.naturalHeight || 1;
    const width = Math.min(bounds.width * .94, bounds.height * .94 * ratio);
    const height = width / ratio;
    return { left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2, width, height };
  };
  const animateImage = (id: string, entering: boolean): Animation | undefined => {
    const image = imageFor(id);
    if (!image || !image.complete || !image.naturalWidth || reduced()) return;
    const tile = image.getBoundingClientRect(), expanded = expandedBounds(image, id);
    if (!tile.width || !tile.height || !expanded.width || !expanded.height) return;
    const requiredScale = Math.max(expanded.width / image.naturalWidth, expanded.height / image.naturalHeight);
    if (requiredScale > 1.25) return;
    const transform = `translate(${expanded.left - tile.left}px, ${expanded.top - tile.top}px) scale(${expanded.width / tile.width}, ${expanded.height / tile.height})`;
    const bounds = root.current!.getBoundingClientRect();
    const flying = image.cloneNode() as HTMLImageElement;
    flying.removeAttribute('data-document-id');
    flying.className = 'ui-document-overview__flying';
    Object.assign(flying.style, { left: `${tile.left - bounds.left}px`, top: `${tile.top - bounds.top}px`,
      width: `${tile.width}px`, height: `${tile.height}px`, visibility: 'visible' });
    image.style.visibility = 'hidden';
    root.current!.append(flying);
    const animation = flying.animate(entering ? [{ transform }, { transform: 'none' }] : [{ transform: 'none' }, { transform }],
      { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    const cleanup = () => { flying.remove(); image.style.visibility = ''; };
    void animation.finished.then(cleanup, cleanup);
    animations.current.push(animation);
    return animation;
  };
  const close = (id: string) => {
    if (closing.current) return;
    closing.current = true;
    animations.current.forEach(animation => animation.cancel());
    const animation = animateImage(id, false);
    const done = () => callbacks.current.onDismiss();
    if (animation) void animation.finished.then(done, () => {});
    else done();
  };
  const select = (id: string) => {
    if (id === activeId && documents.find(item => item.id === id)?.ready !== false) { close(id); return; }
    setPendingId(id);
    callbacks.current.onSelect(id);
  };
  const dismiss = () => {
    if (!pendingId) { close(activeId); return; }
    setPendingId(initialId.current);
    callbacks.current.onSelect(initialId.current);
  };
  useEffect(() => {
    if (!pendingId || pendingId !== activeId) return;
    const document = documents.find(item => item.id === pendingId);
    if (document && document.ready !== false) close(pendingId);
  }, [activeId, documents, pendingId]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    source.current = target.getActiveBounds?.();
    const previousFocus = document.activeElement as HTMLElement | null;
    const selected = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-document-choice]'))
      .find(button => button.dataset.documentChoice === activeId);
    selected?.scrollIntoView({ block: 'nearest' });
    (selected ?? element).focus({ preventScroll: true });
    const image = imageFor(activeId);
    const enter = () => { if (!closing.current) animateImage(activeId, true); };
    if (image?.complete) enter();
    else image?.addEventListener('load', enter, { once: true });
    const onKey = (event: KeyboardEvent) => {
      if (!element.contains(document.activeElement)) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const id = (document.activeElement as HTMLElement).dataset.documentChoice;
        if (id) select(id); else dismiss();
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-document-choice]'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const columns = Math.max(1, buttons.filter(button => button.offsetTop === buttons[0]?.offsetTop).length);
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + delta));
        buttons[next]?.focus();
      }
    };
    // Keep editor shortcuts out while the overview owns focus.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      image?.removeEventListener('load', enter);
      animations.current.forEach(animation => animation.cancel());
      if (previousFocus?.isConnected && element.contains(document.activeElement)) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const container = target.container.current;
  if (!container) return null;
  return createPortal(<div ref={root} className="ui-document-overview" data-ui-component="document-overview"
    role="dialog" aria-label="Open documents overview" tabIndex={-1} data-editor-native-tab-navigation
    onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header><strong>{pendingId ? documents.find(item => item.id === pendingId)?.presentationError ?? 'Preparing document…' : 'Open documents'}</strong>
      <IconButton aria-label="Close document overview" tabIndex={0} variant="quiet"
        icon={<MaskIcon src={closeIconUrl} />} onClick={dismiss} /></header>
    <div className="ui-document-overview__grid">
      {documents.map(item => <button key={item.id} type="button" data-document-choice={item.id}
        aria-current={item.id === activeId ? 'true' : undefined} aria-busy={pendingId === item.id || undefined}
        title={item.title} onClick={() => select(item.id)}>
        {item.thumbnailUrl ? <img data-document-id={item.id} src={item.thumbnailUrl} alt="" draggable={false} />
          : <span className="ui-document-overview__missing">No preview</span>}
        <span className="ui-document-overview__name">{item.title}{item.dirty ? ' *' : ''}</span>
      </button>)}
    </div>
  </div>, container);
}
