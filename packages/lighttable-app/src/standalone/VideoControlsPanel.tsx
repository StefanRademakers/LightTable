import { useSyncExternalStore } from 'react';
import type { VideoDocumentSession } from '@lighttable/video-core';
import { lightTableIcon } from '../assets/icons';
import { AdjustmentSlider } from '../ui/AdjustmentSlider';
import { SquareIconButton } from '../ui/SquareIconButton';

export interface VideoControlsPanelCommands {
  readonly togglePlayback: () => void;
  readonly seek: (seconds: number) => void;
  readonly stepFrame: (direction: -1 | 1) => void;
  readonly setMuted: (muted: boolean) => void;
  readonly setVolume: (volume: number) => void;
}

interface VideoControlsPanelProps {
  readonly session: VideoDocumentSession;
  readonly commands: VideoControlsPanelCommands;
}

const formatTimecode = (seconds: number, frameRate: number): string => {
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const wholeSeconds = Math.floor(time);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  const frame = Math.min(Math.ceil(fps) - 1, Math.floor((time - wholeSeconds) * fps));
  return [minutes, remainder, frame].map((part) => String(part).padStart(2, '0')).join(':');
};

const TransportButton = ({
  label,
  icon,
  onClick,
  disabled = false
}: {
  readonly label: string;
  readonly icon: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) => (
  <SquareIconButton
    appearance="quiet"
    icon={<img src={lightTableIcon(icon)} alt="" aria-hidden />}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  />
);

/**
 * Presentation-only controls for a VideoDocumentSession. The HTMLVideoElement
 * remains the playback clock; this panel sends commands to that element and
 * observes the shared session snapshot instead of owning duplicate state.
 */
export const VideoControlsPanel = ({ session, commands }: VideoControlsPanelProps) => {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { presentation, metadata, lifecycle } = snapshot;
  const duration = metadata?.durationSeconds ?? 0;
  const frameRate = metadata?.frameRate ?? 30;
  const ready = lifecycle === 'ready';
  const effectivelyMuted = presentation.muted || presentation.volume === 0;

  return (
    <section className="lighttable-video-controls" aria-label="Video controls">
      <div className="lighttable-video-controls__row">
        <output
          className="lighttable-video-controls__time"
          aria-label="Current video time"
        >
          {formatTimecode(presentation.currentTimeSeconds, frameRate)}
        </output>
        <div className="lighttable-video-controls__transport" role="group" aria-label="Playback">
          <TransportButton
            label="Previous frame"
            icon="previous_scene.png"
            disabled={!ready}
            onClick={() => commands.stepFrame(-1)}
          />
          <TransportButton
            label={presentation.paused ? 'Play' : 'Pause'}
            icon={presentation.paused ? 'play.png' : 'pause.png'}
            disabled={!ready}
            onClick={commands.togglePlayback}
          />
          <TransportButton
            label="Next frame"
            icon="next_scene.png"
            disabled={!ready}
            onClick={() => commands.stepFrame(1)}
          />
        </div>
        <div className="lighttable-video-controls__volume" role="group" aria-label="Volume">
          <TransportButton
            label={effectivelyMuted ? 'Unmute' : 'Mute'}
            icon={effectivelyMuted ? 'audio_oiff.png' : 'audio_on.png'}
            disabled={!ready}
            onClick={() => commands.setMuted(!presentation.muted)}
          />
          <div className="lighttable-video-controls__volume-slider">
            <AdjustmentSlider
              label="Volume"
              ariaLabel="Video volume"
              layout="bare"
              value={presentation.volume}
              min={0}
              max={1}
              step={0.01}
              resetValue={1}
              showResetMarker={false}
              disabled={!ready}
              interactionMode="native"
              onChange={commands.setVolume}
              onReset={() => commands.setVolume(1)}
            />
          </div>
        </div>
      </div>
      <div className="lighttable-video-controls__scrubber">
        <AdjustmentSlider
          label="Video time"
          layout="bare"
          value={Math.min(duration, presentation.currentTimeSeconds)}
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.001}
          resetValue={0}
          showResetMarker={false}
          disabled={!ready || duration <= 0}
          interactionMode="native"
          onChange={commands.seek}
          onReset={() => commands.seek(0)}
        />
      </div>
    </section>
  );
};
