import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportControls, VIDEO_TRANSPORT_ACTIONS, VideoTransportControls } from './TransportControls';

afterEach(cleanup);

describe('TransportControls', () => {
  it('emits controlled action intent and exposes shortcut metadata', () => {
    const onAction = vi.fn();
    render(<TransportControls label="Playback" onAction={onAction} items={[
      { value: 'play', label: 'Play', icon: <span />, shortcut: 'Space', keyShortcut: 'Space' },
      { value: 'stop', label: 'Stop', icon: <span />, disabled: true }
    ]} />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).toHaveAttribute('title', 'Play (Space)');
    expect(play).toHaveAttribute('aria-keyshortcuts', 'Space');
    fireEvent.click(play);
    expect(onAction).toHaveBeenCalledWith('play');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('offers one optional tab stop and arrows across enabled actions', () => {
    render(<TransportControls tabIndex={0} onAction={() => {}} items={[
      { value: 'previous', label: 'Previous', icon: <span /> },
      { value: 'disabled', label: 'Disabled', icon: <span />, disabled: true },
      { value: 'next', label: 'Next', icon: <span /> }
    ]} />);
    const previous = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    previous.focus();
    fireEvent.keyDown(previous, { key: 'ArrowRight' });
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('tabindex', '0');
  });
});

describe('VideoTransportControls', () => {
  it('provides the six canonical actions in order without handling their commands', () => {
    const onAction = vi.fn();
    render(<VideoTransportControls onAction={onAction} playbackState="forward" loop />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      'Go to previous edit', 'Play reverse', 'Stop', 'Play forward', 'Go to next edit', 'Loop playback'
    ]);
    expect(screen.getByRole('button', { name: 'Play forward' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Loop playback' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Go to previous edit' }));
    expect(onAction).toHaveBeenCalledWith(VIDEO_TRANSPORT_ACTIONS.previousEdit);
  });
});
