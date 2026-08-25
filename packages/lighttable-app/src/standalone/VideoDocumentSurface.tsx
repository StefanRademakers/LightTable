import React, { useEffect, useRef, useState } from 'react';
import type { VideoDocumentSession } from '@lighttable/video-core';
import { externalMediaSourceFor } from './externalMediaSource';

interface VideoDocumentSurfaceProps {
  readonly file: File;
  readonly session: VideoDocumentSession;
  readonly active: boolean;
}

export const VideoDocumentSurface: React.FC<VideoDocumentSurfaceProps> = ({
  file,
  session,
  active
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    const external = externalMediaSourceFor(file);
    if (external) {
      setSourceUrl(external.url);
      return () => setSourceUrl(null);
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => {
      setSourceUrl(null);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || Boolean(target.closest('input, textarea, select, button, [data-editor-floating-control]'))
      )) return;
      const video = videoRef.current;
      if (!video || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        const direction = event.code === 'ArrowRight' ? 1 : -1;
        video.currentTime = Math.max(0, Math.min(
          Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY,
          video.currentTime + direction * (event.shiftKey ? 10 : 1)
        ));
        session.updatePresentation({ currentTimeSeconds: video.currentTime });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, session]);

  return (
    <main className="lighttable-video-document" aria-label={`Video document ${file.name}`}>
      {sourceUrl ? (
        <video
          ref={videoRef}
          className="lighttable-video-document__media"
          src={sourceUrl}
          controls
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            session.publishReady({
              width: video.videoWidth,
              height: video.videoHeight,
              durationSeconds: Number.isFinite(video.duration) ? video.duration : 0
            });
            const presentation = session.getSnapshot().presentation;
            video.currentTime = presentation.currentTimeSeconds;
            video.muted = presentation.muted;
            video.volume = presentation.volume;
            video.playbackRate = presentation.playbackRate;
          }}
          onTimeUpdate={(event) => session.updatePresentation({
            currentTimeSeconds: event.currentTarget.currentTime
          })}
          onSeeked={(event) => session.updatePresentation({
            currentTimeSeconds: event.currentTarget.currentTime
          })}
          onPlay={() => session.updatePresentation({ paused: false })}
          onPause={() => session.updatePresentation({ paused: true })}
          onVolumeChange={(event) => session.updatePresentation({
            muted: event.currentTarget.muted,
            volume: event.currentTarget.volume
          })}
          onRateChange={(event) => session.updatePresentation({
            playbackRate: event.currentTarget.playbackRate
          })}
          onError={() => session.publishFailure('Video could not be decoded by this LightTable build.')}
        />
      ) : null}
    </main>
  );
};
