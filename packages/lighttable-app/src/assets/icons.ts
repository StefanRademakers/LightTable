import folderIcon from './icons/folder.png?url';
import { pipetteIconUrl } from '@lighttable/ui';

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
  './icons/tool_sample_color.png': pipetteIconUrl
} as Record<string, string>;

export const lightTableIcon = (name: string): string => {
  const icon = icons[`./icons/${name}`];
  if (!icon) throw new Error(`Unknown LightTable icon: ${name}`);
  return icon;
};
