const isMacPlatform = () => typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);

export const primaryShortcutLabel = (key: string, shift = false): string => (
  isMacPlatform()
    ? `${shift ? '⇧' : ''}⌘${key}`
    : `Ctrl+${shift ? 'Shift+' : ''}${key}`
);
