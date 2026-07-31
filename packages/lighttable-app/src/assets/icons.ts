const iconImportOptions = {
  eager: true,
  query: '?url',
  import: 'default'
} as const;

const icons = {
  ...import.meta.glob('./icons/*.png', iconImportOptions),
  ...import.meta.glob('./icons/*.svg', iconImportOptions)
} as Record<string, string>;

export const lightTableIcon = (name: string): string => {
  const icon = icons[`./icons/${name}`];
  if (!icon) throw new Error(`Unknown LightTable icon: ${name}`);
  return icon;
};
