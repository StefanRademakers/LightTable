import folderIcon from './icons/folder.png?url';
import { pipetteIconUrl, sectionOpenIconUrl, sectionClosedIconUrl, resetIconUrl, trashIconUrl, searchIconUrl, closeIconUrl } from '@lighttable/ui';

const icons = {
  ...import.meta.glob('./icons/*.png', {
    eager: true,
    query: '?url',
    import: 'default'
  }),
  ...import.meta.glob('./icons/*.svg', {
    eager: true,
    query: '?url',
    import: 'default'
  }),
  './icons/folder.png': folderIcon,
  './icons/tool_sample_color.png': pipetteIconUrl,
  './icons/area_open.png': sectionOpenIconUrl,
  './icons/area_closed.png': sectionClosedIconUrl,
  './icons/settings_reset.png': resetIconUrl,
  './icons/layer_trash.png': trashIconUrl,
  './icons/search.png': searchIconUrl,
  './icons/close.png': closeIconUrl
} as Record<string, string>;

export const lightTableIcon = (name: string): string => {
  const icon = icons[`./icons/${name}`];
  if (!icon) throw new Error(`Unknown LightTable icon: ${name}`);
  return icon;
};
