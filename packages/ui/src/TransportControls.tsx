import { useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { MaskIcon } from './MaskIcon';
import {
  transportPlayIconUrl,
  transportPlayReverseIconUrl,
  transportRepeatIconUrl,
  transportSkipNextIconUrl,
  transportSkipPreviousIconUrl,
  transportStopIconUrl
} from './icons';

export interface TransportControlItem<T extends string = string> {
  value: T;
  label: string;
  icon: ReactNode;
  /** Human-readable shortcut appended to the native tooltip. */
  shortcut?: string;
  /** WAI-ARIA shortcut syntax, for example `Control+/ Meta+/`. */
  keyShortcut?: string;
  disabled?: boolean;
  pressed?: boolean;
}

export interface TransportControlsProps<T extends string = string>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: readonly TransportControlItem<T>[];
  onAction: (value: T) => void;
  label?: string;
  /** Use 0 when this standalone toolbar should be reachable with Tab. Editor chrome defaults to -1. */
  tabIndex?: 0 | -1;
}

/** Controlled horizontal transport surface. Playback state and commands remain host-owned. */
export function TransportControls<T extends string>({
  items,
  onAction,
  label = 'Transport controls',
  tabIndex = -1,
  className = '',
  onKeyDown,
  ...props
}: TransportControlsProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const firstEnabledIndex = Math.max(0, items.findIndex(item => !item.disabled));
  const [focusIndex, setFocusIndex] = useState(firstEnabledIndex);
  const enabledIndices = useMemo(
    () => items.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0),
    [items]
  );

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || enabledIndices.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button');
    const activeIndex = buttons ? [...buttons].indexOf(document.activeElement as HTMLButtonElement) : -1;
    const enabledPosition = Math.max(0, enabledIndices.indexOf(activeIndex));
    const nextIndex = event.key === 'Home' ? enabledIndices[0]
      : event.key === 'End' ? enabledIndices.at(-1)
      : enabledIndices[(enabledPosition + (event.key === 'ArrowRight' ? 1 : -1) + enabledIndices.length) % enabledIndices.length];
    if (nextIndex === undefined) return;
    setFocusIndex(nextIndex);
    buttons?.[nextIndex]?.focus();
  };

  return <div {...props} ref={root} className={`ui-transport-controls${className ? ` ${className}` : ''}`}
    role="toolbar" aria-label={label} aria-orientation="horizontal" data-ui-component="transport-controls"
    onKeyDown={moveFocus}>
    {items.map((item, index) => {
      const title = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
      return <IconButton key={item.value} variant="quiet" size="regular" icon={item.icon}
        aria-label={item.label} aria-keyshortcuts={item.keyShortcut} title={title}
        disabled={item.disabled} active={item.pressed}
        tabIndex={tabIndex === 0 && index === focusIndex && !item.disabled ? 0 : -1}
        onFocus={() => setFocusIndex(index)} onClick={() => onAction(item.value)} />;
    })}
  </div>;
}

export const VIDEO_TRANSPORT_ACTIONS = {
  previousEdit: 'previous-edit',
  playReverse: 'play-reverse',
  stop: 'stop',
  playForward: 'play-forward',
  nextEdit: 'next-edit',
  toggleLoop: 'toggle-loop'
} as const;

export type VideoTransportAction = typeof VIDEO_TRANSPORT_ACTIONS[keyof typeof VIDEO_TRANSPORT_ACTIONS];
export type VideoPlaybackState = 'reverse' | 'stopped' | 'forward';

export interface VideoTransportControlsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  onAction: (action: VideoTransportAction) => void;
  playbackState?: VideoPlaybackState;
  loop?: boolean;
  disabled?: boolean;
  disabledActions?: readonly VideoTransportAction[];
  shortcuts?: Partial<Record<VideoTransportAction, string>>;
  label?: string;
  tabIndex?: 0 | -1;
}

const defaultVideoShortcuts: Record<VideoTransportAction, string> = {
  'previous-edit': '↑',
  'play-reverse': 'J',
  stop: 'K',
  'play-forward': 'L',
  'next-edit': '↓',
  'toggle-loop': 'Ctrl/Cmd+/'
};

const videoKeyShortcuts: Record<VideoTransportAction, string> = {
  'previous-edit': 'ArrowUp',
  'play-reverse': 'J',
  stop: 'K',
  'play-forward': 'L',
  'next-edit': 'ArrowDown',
  'toggle-loop': 'Control+/ Meta+/'
};

/** Resolve-style six-button video transport composition. It emits intent and never installs global hotkeys. */
export function VideoTransportControls({
  onAction,
  playbackState,
  loop,
  disabled = false,
  disabledActions = [],
  shortcuts,
  label = 'Video transport controls',
  tabIndex = -1,
  ...props
}: VideoTransportControlsProps) {
  const disabledSet = new Set(disabledActions);
  const item = (value: VideoTransportAction, itemLabel: string, iconUrl: string, pressed?: boolean): TransportControlItem<VideoTransportAction> => ({
    value,
    label: itemLabel,
    icon: <MaskIcon src={iconUrl} mode="luminance" />,
    shortcut: shortcuts?.[value] ?? defaultVideoShortcuts[value],
    keyShortcut: videoKeyShortcuts[value],
    disabled: disabled || disabledSet.has(value),
    pressed
  });
  const playbackPressed = (state: VideoPlaybackState) => playbackState === undefined ? undefined : playbackState === state;
  const items = [
    item(VIDEO_TRANSPORT_ACTIONS.previousEdit, 'Go to previous edit', transportSkipPreviousIconUrl),
    item(VIDEO_TRANSPORT_ACTIONS.playReverse, 'Play reverse', transportPlayReverseIconUrl, playbackPressed('reverse')),
    item(VIDEO_TRANSPORT_ACTIONS.stop, 'Stop', transportStopIconUrl, playbackPressed('stopped')),
    item(VIDEO_TRANSPORT_ACTIONS.playForward, 'Play forward', transportPlayIconUrl, playbackPressed('forward')),
    item(VIDEO_TRANSPORT_ACTIONS.nextEdit, 'Go to next edit', transportSkipNextIconUrl),
    item(VIDEO_TRANSPORT_ACTIONS.toggleLoop, 'Loop playback', transportRepeatIconUrl, loop)
  ] as const;
  return <TransportControls {...props} items={items} onAction={onAction} label={label} tabIndex={tabIndex} />;
}
