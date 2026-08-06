import type { KeyboardEvent } from 'react';

export const navigateFontPicker = (event: KeyboardEvent<HTMLDivElement>): boolean => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return false;
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  if (!options.length) return false;
  event.preventDefault();
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
    : index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options[next]?.focus();
  return true;
};
