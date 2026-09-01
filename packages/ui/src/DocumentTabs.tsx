import { useLayoutEffect, useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Menu, type MenuOption } from './Menu';
import { IconButton } from './IconButton';
import { MaskIcon } from './MaskIcon';
import { sectionOpenIconUrl, documentGridIconUrl } from './icons';
import { DocumentOverview, type DocumentOverviewTarget } from './DocumentOverview';

export interface DocumentTab {
  id: string;
  title: string;
  dirty?: boolean;
  thumbnailUrl?: string;
  onClose?: () => void;
  /** True after this document has presented a valid frame in the host. */
  ready?: boolean;
  presentationError?: string;
}
export interface DocumentTabsProps {
  documents: readonly DocumentTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onDocumentDragStart?: (event: DragEvent<HTMLElement>, document: DocumentTab) => void;
  contextMenu?: (document: DocumentTab) => readonly MenuOption[];
  label?: string;
  overview?: DocumentOverviewTarget;
  overviewShortcut?: string;
}

/** Chrome only: document lifetimes, preview URLs and file actions belong to the host. */
export function DocumentTabs({ documents, activeId, onSelect, onDocumentDragStart, contextMenu, overview, overviewShortcut,
  label = 'Open documents' }: DocumentTabsProps) {
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const overviewButton = useRef<HTMLButtonElement>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [menu, setMenu] = useState<{ id?: string; x?: number; y?: number } | null>(null);
  const [preview, setPreview] = useState<{ id: string; left: number; top: number; theme?: string } | null>(null);
  const canOverview = Boolean(overview && documents.length > 1);
  const order = documents.map(item => item.id).join('\0');
  const reveal = () => {
    const viewport = strip.current;
    const selected = viewport?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
    if (!viewport || !selected) return;
    const bounds = viewport.getBoundingClientRect(), tab = selected.getBoundingClientRect();
    if (tab.left < bounds.left) viewport.scrollLeft -= bounds.left - tab.left;
    else if (tab.right > bounds.right) viewport.scrollLeft += tab.right - bounds.right;
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      // Test the full row, not the viewport reduced by the overflow button.
      // This avoids a show/hide feedback loop near the fitting boundary.
      const minimum = parseFloat(getComputedStyle(element).getPropertyValue('--ui-document-tab-min-width'));
      setOverflow(documents.length * minimum > element.clientWidth - (canOverview ? overviewButton.current?.offsetWidth ?? 0 : 0));
      reveal();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [order, canOverview]);
  useLayoutEffect(reveal, [activeId, order, overflow]);
  useEffect(() => {
    setPreview(null);
    setMenu(null);
  }, [activeId, order]);
  useEffect(() => {
    if (!preview) return;
    const dismiss = () => setPreview(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, [preview]);
  useEffect(() => {
    if (!canOverview || !overviewShortcut) return;
    const toggleOverview = (event: KeyboardEvent) => {
      if (event.code !== overviewShortcut || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
      setMenu(null);
      setOverviewOpen(value => !value);
    };
    window.addEventListener('keydown', toggleOverview, true);
    return () => window.removeEventListener('keydown', toggleOverview, true);
  }, [canOverview, overviewShortcut]);
  useEffect(() => {
    if (!canOverview) setOverviewOpen(false);
  }, [canOverview]);
  const contextDocument = menu?.id ? documents.find(item => item.id === menu.id) : undefined;
  const previewDocument = preview ? documents.find(item => item.id === preview.id) : undefined;
  const select = (id: string) => { setPreview(null); onSelect(id); };
  return <div ref={root} className="ui-document-tabs" data-overflow={overflow || undefined}
    data-ui-component="document-tabs" data-suite-control="document-tabs">
    <div ref={strip} className="ui-document-tabs__strip" role="tablist" aria-label={label}
      onWheel={event => {
        if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        event.currentTarget.scrollLeft += event.deltaY;
      }}>
      {documents.map(item => <div key={item.id} className="ui-document-tabs__tab" data-active={item.id === activeId || undefined}
        draggable={Boolean(onDocumentDragStart)}
        onDragStart={event => { setPreview(null); onDocumentDragStart?.(event, item); }}
        onMouseEnter={event => {
          if (menu || overviewOpen || item.id === activeId || !item.thumbnailUrl) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setPreview({ id: item.id, left: Math.max(4, Math.min(bounds.left, window.innerWidth - 184)),
            top: Math.max(4, Math.min(bounds.bottom, window.innerHeight - 184)),
            theme: event.currentTarget.closest<HTMLElement>('[data-ui-theme]')?.dataset.uiTheme });
        }} onMouseLeave={() => setPreview(null)}
        onContextMenu={event => {
          if (!contextMenu) return;
          event.preventDefault(); event.stopPropagation(); setPreview(null);
          setMenu({ id: item.id, x: event.clientX, y: event.clientY });
        }}>
        <button type="button" role="tab" tabIndex={-1} aria-selected={item.id === activeId}
          className="ui-document-tabs__title" title={item.title} onClick={() => select(item.id)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const index = documents.findIndex(tab => tab.id === item.id);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? documents.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + documents.length) % documents.length;
            select(documents[next].id);
            strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
          }}>
          <span>{item.title}</span>{item.dirty ? <span aria-label="Unsaved changes">*</span> : null}
        </button>
        {item.onClose ? <button type="button" tabIndex={-1} className="ui-document-tabs__close"
          aria-label={`Close ${item.title}`} title={`Close ${item.title}`} draggable={false}
          onPointerDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); item.onClose?.(); }}>×</button> : null}
      </div>)}
    </div>
    {canOverview ? <IconButton ref={overviewButton} className="ui-document-tabs__overview-button" variant="quiet"
      aria-label="Document overview" title="Document overview"
      aria-expanded={overviewOpen} icon={<MaskIcon src={documentGridIconUrl} />} onClick={() => {
        setPreview(null); setMenu(null); setOverviewOpen(value => !value);
      }} /> : null}
    {overflow ? <IconButton ref={more} className="ui-document-tabs__more-button" variant="quiet"
      aria-label="All open documents" title="All open documents"
      aria-haspopup="menu" aria-expanded={menu !== null && !menu.id}
      icon={<MaskIcon src={sectionOpenIconUrl} />} onClick={() => { setPreview(null); setMenu(menu && !menu.id ? null : {}); }} /> : null}
    <Menu open={menu !== null} label={contextDocument ? `Document: ${contextDocument.title}` : 'All open documents'}
      anchor={menu?.id ? undefined : more} x={menu?.x} y={menu?.y} align={menu?.id ? 'start' : 'end'}
      data-editor-native-tab-navigation onClose={() => setMenu(null)} options={contextDocument ? contextMenu?.(contextDocument) ?? []
        : documents.map(item => ({ value: item.id, label: `${item.title}${item.dirty ? ' *' : ''}`,
          selected: item.id === activeId, onClick: () => select(item.id) }))} />
    {preview && previewDocument?.thumbnailUrl ? createPortal(
      <div className="ui-document-tabs__preview" role="tooltip" aria-label={`Preview ${previewDocument.title}`}
        data-ui-component="document-tab-preview" data-ui-theme={preview.theme} style={{ left: preview.left, top: preview.top }}>
        <img src={previewDocument.thumbnailUrl} alt="" />
      </div>, document.body) : null}
    {overviewOpen && canOverview && overview ? <DocumentOverview documents={documents} activeId={activeId} target={overview}
      onSelect={select} onDismiss={() => { setOverviewOpen(false); overviewButton.current?.focus({ preventScroll: true }); }} /> : null}
  </div>;
}
