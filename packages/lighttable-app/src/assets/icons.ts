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
  })
} as Record<string, string>;

export const lightTableIcon = (name: string): string => {
  const icon = icons[`./icons/${name}`];
  if (!icon) throw new Error(`Unknown LightTable icon: ${name}`);
  return icon;
};
