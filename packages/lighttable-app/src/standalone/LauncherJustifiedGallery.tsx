import React from 'react';
import { ButtonBase } from '../ui/ButtonBase';
import { Menu, type MenuOption } from '@lighttable/ui';

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
  readonly removeLabel?: string;
}

export const launcherGalleryShowsRemoveAction = (item: LauncherGalleryItem): boolean => (
  Boolean(item.onRemove) && (item.available === false || Boolean(item.removeLabel))
);

const GalleryCard = ({ item, preview, opening, onPreview, onContextMenu }: {
  readonly item: LauncherGalleryItem;
  readonly preview?: string;
  readonly opening: boolean;
  readonly onPreview: (url: string) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}) => {
  const target = React.useRef<HTMLDivElement>(null);
  const request = React.useRef<{ id: string; promise: Promise<string | null> } | null>(null);
  const loadPreviewRef = React.useRef(item.loadPreview);
  loadPreviewRef.current = item.loadPreview;
  const onPreviewRef = React.useRef(onPreview);
  onPreviewRef.current = onPreview;
  const [nearViewport, setNearViewport] = React.useState(
    () => typeof IntersectionObserver === 'undefined'
  );
  React.useEffect(() => {
    const element = target.current;
    if (!element) return undefined;
    let mounted = true;
    let subscribed = false;
    const load = () => {
      const loadPreview = loadPreviewRef.current;
      if (preview || !loadPreview || subscribed) return;
      subscribed = true;
      // Reconnect to pending work after Strict Mode effect replay. Ordinary
      // parent renders may replace the callback, but must not discard its result.
      if (request.current?.id !== item.id) {
        request.current = { id: item.id, promise: Promise.resolve().then(loadPreview) };
      }
      void request.current.promise.then((url) => {
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
  }, [item.id, preview]);

  const available = item.available !== false;
  return <article ref={target} className={`lighttable-launcher-gallery__card${available ? '' : ' is-missing'}`}
    onContextMenu={onContextMenu}>
    <ButtonBase type="button" disabled={opening || !available} onClick={item.onOpen}>
      <span className="lighttable-launcher-gallery__preview">
        {preview && nearViewport ? <img src={preview} alt="" draggable={false} />
          : preview ? null : <span>{available ? 'No preview' : 'Missing'}</span>}
      </span>
      <span className="lighttable-launcher-gallery__footer">
        <strong title={item.title}>{item.title}</strong>
        {item.subtitle ? <small title={item.subtitle}>{item.subtitle}</small> : null}
      </span>
    </ButtonBase>
    {launcherGalleryShowsRemoveAction(item) ? <ButtonBase
      className="lighttable-launcher-gallery__remove" type="button" onClick={item.onRemove}
      aria-label={item.removeLabel ?? `Remove ${item.title}`}>×</ButtonBase> : null}
  </article>;
};

export const LauncherJustifiedGallery = ({ items, opening }: {
  readonly items: readonly LauncherGalleryItem[];
  readonly opening: boolean;
}) => {
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [menu, setMenu] = React.useState<{ readonly item: LauncherGalleryItem; readonly x: number; readonly y: number }>();
  const itemIdsKey = items.map(({ id }) => id).join('\u0000');

  React.useEffect(() => {
    const retained = new Set(items.map(({ id }) => id));
    setPreviews((current) => Object.fromEntries(Object.entries(current)
      .filter(([id]) => retained.has(id))));
  }, [itemIdsKey]);

  const menuOptions: Array<MenuOption<string>> = menu ? [
    { value: 'open', label: 'Open', disabled: menu.item.available === false, onClick: menu.item.onOpen },
    { value: 'reveal', label: 'Open File Location', disabled: menu.item.available === false || !menu.item.onReveal,
      onClick: menu.item.onReveal },
    { value: 'remove', label: menu.item.removeLabel ?? 'Remove from Recents', separatorBefore: true,
      disabled: !menu.item.onRemove,
      onClick: menu.item.onRemove }
  ] : [];

  return <div className="lighttable-launcher-gallery">
    {items.map((item) => {
      const preview = item.previewUrl ?? previews[item.id];
      return <div key={item.id} className="lighttable-launcher-gallery__item">
        <GalleryCard item={item} preview={preview} opening={opening}
          onPreview={(url) => setPreviews((current) => ({ ...current, [item.id]: url }))}
          onContextMenu={(event) => {
            if (!item.onReveal && !item.onRemove) return;
            event.preventDefault();
            setMenu({ item, x: event.clientX, y: event.clientY });
          }} />
      </div>;
    })}
    <Menu data-editor-native-tab-navigation open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0}
      onClose={() => setMenu(undefined)} options={menuOptions} />
  </div>;
};
