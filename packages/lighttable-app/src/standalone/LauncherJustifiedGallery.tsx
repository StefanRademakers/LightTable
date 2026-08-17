import React from 'react';
import { ButtonBase } from '../ui/ButtonBase';
import { ContextMenu, type ContextMenuOption } from '../ui/ContextMenu';
import { buildJustifiedLayout } from '../genai/ui/justifiedLayout';

export interface LauncherGalleryItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly available?: boolean;
  readonly previewUrl?: string;
  readonly loadPreview?: () => Promise<string | null>;
  readonly onOpen: () => void;
  readonly onReveal?: () => void;
  readonly onRemove?: () => void;
}

const GAP = 8;
const INSET = 8;
const FOOTER_HEIGHT = 28;
const TARGET_ROW_HEIGHT = 180;

const GalleryCard = ({ item, preview, opening, height, onPreview, onRatio, onContextMenu }: {
  readonly item: LauncherGalleryItem;
  readonly preview?: string;
  readonly opening: boolean;
  readonly height: number;
  readonly onPreview: (url: string) => void;
  readonly onRatio: (ratio: number) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}) => {
  const target = React.useRef<HTMLDivElement>(null);
  const requested = React.useRef(false);
  const onPreviewRef = React.useRef(onPreview);
  const onRatioRef = React.useRef(onRatio);
  onPreviewRef.current = onPreview;
  onRatioRef.current = onRatio;
  const [nearViewport, setNearViewport] = React.useState(
    () => typeof IntersectionObserver === 'undefined'
  );
  React.useEffect(() => {
    const element = target.current;
    if (!element) return undefined;
    let mounted = true;
    const load = () => {
      if (preview || !item.loadPreview || requested.current) return;
      requested.current = true;
      void item.loadPreview().then((url) => {
        if (mounted && url) onPreviewRef.current(url);
      }).catch(() => undefined);
    };
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      load();
      return () => { mounted = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!mounted) return;
      const visible = entries.some(({ isIntersecting }) => isIntersecting);
      setNearViewport(visible);
      if (visible) load();
    }, { rootMargin: '320px' });
    observer.observe(element);
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [item.id, item.loadPreview, preview]);

  const available = item.available !== false;
  return <article ref={target} className={`lighttable-launcher-gallery__card${available ? '' : ' is-missing'}`}
    onContextMenu={onContextMenu}>
    <ButtonBase type="button" disabled={opening || !available} onClick={item.onOpen}>
      <span className="lighttable-launcher-gallery__preview" style={{ height }}>
        {preview && nearViewport ? <img src={preview} alt="" draggable={false} onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalHeight) onRatioRef.current(image.naturalWidth / image.naturalHeight);
        }} /> : preview ? null : <span>{available ? 'No preview' : 'Missing'}</span>}
      </span>
      <span className="lighttable-launcher-gallery__footer">
        <strong title={item.title}>{item.title}</strong>
        {item.subtitle ? <small title={item.subtitle}>{item.subtitle}</small> : null}
      </span>
    </ButtonBase>
    {!available && item.onRemove ? <ButtonBase className="lighttable-launcher-gallery__remove"
      type="button" onClick={item.onRemove} aria-label={`Remove ${item.title}`}>×</ButtonBase> : null}
  </article>;
};

export const LauncherJustifiedGallery = ({ items, opening }: {
  readonly items: readonly LauncherGalleryItem[];
  readonly opening: boolean;
}) => {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [ratios, setRatios] = React.useState<Record<string, number>>({});
  const [menu, setMenu] = React.useState<{ readonly item: LauncherGalleryItem; readonly x: number; readonly y: number }>();
  const itemIdsKey = items.map(({ id }) => id).join('\u0000');

  React.useLayoutEffect(() => {
    if (!element) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = Math.round(element.clientWidth);
        setWidth((current) => current === next ? current : next);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [element]);

  React.useEffect(() => {
    const retained = new Set(items.map(({ id }) => id));
    setPreviews((current) => Object.fromEntries(Object.entries(current)
      .filter(([id]) => retained.has(id))));
    setRatios((current) => Object.fromEntries(Object.entries(current)
      .filter(([id]) => retained.has(id))));
  }, [itemIdsKey]);

  const layoutInput = items.map((item) => ({
    key: item.id,
    aspectRatio: ratios[item.id] ?? 1.5
  }));
  const contentWidth = Math.max(0, width - (INSET * 2));
  const layout = buildJustifiedLayout(layoutInput, contentWidth, TARGET_ROW_HEIGHT, GAP, FOOTER_HEIGHT);
  const byId = new Map(items.map((item) => [item.id, item]));

  const menuOptions: Array<ContextMenuOption<string>> = menu ? [
    { value: 'open', label: 'Open', disabled: menu.item.available === false, onClick: menu.item.onOpen },
    { value: 'reveal', label: 'Open File Location', disabled: menu.item.available === false || !menu.item.onReveal,
      onClick: menu.item.onReveal },
    { value: 'remove', label: 'Remove from Recents', separatorBefore: true, disabled: !menu.item.onRemove,
      onClick: menu.item.onRemove }
  ] : [];

  return <div ref={setElement} className="lighttable-launcher-gallery"
    style={{ height: layout.height ? layout.height + (INSET * 2) : 0 }}>
    {layout.items.map((layoutItem) => {
      const item = byId.get(layoutItem.key)!;
      const preview = item.previewUrl ?? previews[item.id];
      return <div key={item.id} className="lighttable-launcher-gallery__item" style={{
        transform: `translate(${layoutItem.x + INSET}px, ${layoutItem.y + INSET}px)`,
        width: layoutItem.width,
        height: layoutItem.height + FOOTER_HEIGHT
      }}><GalleryCard item={item} preview={preview} opening={opening} height={layoutItem.height}
          onPreview={(url) => setPreviews((current) => ({ ...current, [item.id]: url }))}
          onRatio={(ratio) => setRatios((current) => Math.abs((current[item.id] ?? 0) - ratio) < 0.0001
            ? current : { ...current, [item.id]: ratio })}
          onContextMenu={(event) => {
            if (!item.onReveal) return;
            event.preventDefault();
            setMenu({ item, x: event.clientX, y: event.clientY });
          }} /></div>;
    })}
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0}
      onClose={() => setMenu(undefined)} options={menuOptions} />
  </div>;
};
