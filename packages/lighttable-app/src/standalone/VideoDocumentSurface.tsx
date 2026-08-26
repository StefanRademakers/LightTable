import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  measureVideoPlaybackTelemetry,
  type VideoDocumentSession,
  type VideoPlaybackQualitySample,
  type VideoPresentationState
} from '@lighttable/video-core';
import type { ToolId } from '../lighttable/editor/session/editorSession';
import { resolveViewportImageRect } from '../lighttable/application/rendering/viewportRenderState';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  panViewFromGesture,
  panViewFromWheel,
  resolveWheelPanDeltas,
  zoomViewAtPoint,
  zoomViewToScaleAtPoint,
  zoomViewToViewportRect,
  type Point
} from '../lighttable/editor/tools/pointer/viewportCoordinates';
import { steppedZoomPercent, zoomPercentToScale } from '../lighttable/editor/tools/zoom/zoomLevels';
import { externalMediaSourceFor } from './externalMediaSource';

interface VideoDocumentSurfaceProps {
  readonly file: File;
  readonly session: VideoDocumentSession;
  readonly active: boolean;
  /** Effective workspace tool, including temporary keyboard overrides. */
  readonly activeTool: ToolId;
  readonly zoomOutActive?: boolean;
  readonly zoomWithScrollWheel: boolean;
  readonly onZoomPercentChange?: (percent: number) => void;
}

export interface VideoViewportHandle {
  readonly setZoomPercent: (percent: number) => void;
  readonly fit: () => void;
  readonly actual: () => void;
  readonly step: (direction: -1 | 1) => void;
  readonly togglePlayback: () => void;
  readonly seek: (seconds: number) => void;
  readonly stepFrame: (direction: -1 | 1) => void;
  readonly setMuted: (muted: boolean) => void;
  readonly setVolume: (volume: number) => void;
}

type VideoViewState = Pick<VideoPresentationState, 'zoomMode' | 'zoom' | 'panX' | 'panY'>;

const viewFromSession = (session: VideoDocumentSession): VideoViewState => {
  const { zoomMode, zoom, panX, panY } = session.getSnapshot().presentation;
  return { zoomMode, zoom, panX, panY };
};

/**
 * Video presentation sink for LightTable's shared Pan and Zoom tools.
 * Tool identity, presets, shortcuts and viewport math stay shared with images;
 * only the final DOM projection and VideoDocumentSession storage differ.
 */
export const VideoDocumentSurface = forwardRef<VideoViewportHandle, VideoDocumentSurfaceProps>(({
  file,
  session,
  active,
  activeTool,
  zoomOutActive = false,
  zoomWithScrollWheel,
  onZoomPercentChange
}, forwardedRef) => {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [metadata, setMetadata] = useState(() => session.getSnapshot().metadata);
  const [view, setView] = useState<VideoViewState>(() => viewFromSession(session));
  const viewRef = useRef(view);
  const metadataRef = useRef(metadata);
  const viewportRef = useRef(viewportSize);
  const pendingViewRef = useRef<VideoViewState | null>(null);
  const frameRef = useRef<number | null>(null);
  const playbackQualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackQualityBaselineRef = useRef<VideoPlaybackQualitySample | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    origin: Point;
    initialView: VideoViewState;
  } | null>(null);
  const zoomDragRef = useRef<{
    pointerId: number;
    start: Point;
    current: Point;
    zoomOut: boolean;
  } | null>(null);
  const [zoomDraft, setZoomDraft] = useState<{ start: Point; current: Point } | null>(null);
  viewRef.current = view;
  metadataRef.current = metadata;
  viewportRef.current = viewportSize;

  useEffect(() => {
    const next = viewFromSession(session);
    viewRef.current = next;
    setView(next);
    const nextMetadata = session.getSnapshot().metadata;
    metadataRef.current = nextMetadata;
    setMetadata(nextMetadata);
  }, [session]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const publish = () => {
      const bounds = root.getBoundingClientRect();
      const next = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
      viewportRef.current = next;
      setViewportSize(next);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

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

  const fitScale = useMemo(() => metadata ? Math.min(
    viewportSize.width / metadata.width,
    viewportSize.height / metadata.height
  ) * 0.94 : 1, [metadata, viewportSize.height, viewportSize.width]);
  const activeScale = view.zoomMode === 'fit' ? fitScale : view.zoomMode === '100' ? 1 : view.zoom;

  const publishView = useCallback((next: VideoViewState) => {
    viewRef.current = next;
    setView(next);
    session.updatePresentation(next);
  }, [session]);

  const scheduleView = useCallback((next: VideoViewState) => {
    pendingViewRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pending) publishView(pending);
    });
  }, [publishView]);

  const flushView = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const pending = pendingViewRef.current;
    pendingViewRef.current = null;
    if (pending) publishView(pending);
  }, [publishView]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (playbackQualityTimerRef.current !== null) clearInterval(playbackQualityTimerRef.current);
  }, []);

  const currentScale = useCallback(() => {
    const current = viewRef.current;
    if (current.zoomMode === '100') return 1;
    if (current.zoomMode === 'custom') return current.zoom;
    const size = viewportRef.current;
    const currentMetadata = metadataRef.current;
    return currentMetadata ? Math.min(
      size.width / currentMetadata.width,
      size.height / currentMetadata.height
    ) * 0.94 : 1;
  }, []);

  const setZoomAtCenter = useCallback((percent: number) => {
    const current = viewRef.current;
    const viewport = viewportRef.current;
    const next = zoomViewToScaleAtPoint({
      cursor: { x: viewport.width / 2, y: viewport.height / 2 },
      viewport,
      view: { scale: currentScale(), panX: current.panX, panY: current.panY },
      scale: zoomPercentToScale(percent)
    });
    publishView({ zoomMode: 'custom', zoom: next.scale, panX: next.panX, panY: next.panY });
  }, [currentScale, publishView]);

  const fit = useCallback(() => publishView({ zoomMode: 'fit', zoom: 1, panX: 0, panY: 0 }), [publishView]);
  const actual = useCallback(() => publishView({ zoomMode: '100', zoom: 1, panX: 0, panY: 0 }), [publishView]);
  const step = useCallback((direction: -1 | 1) => {
    setZoomAtCenter(steppedZoomPercent(currentScale() * 100, direction));
  }, [currentScale, setZoomAtCenter]);

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.max(0, Math.min(duration, seconds));
    session.updatePresentation({ currentTimeSeconds: video.currentTime });
  }, [session]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const stepFrame = useCallback((direction: -1 | 1) => {
    const frameRate = session.getSnapshot().metadata?.frameRate;
    seek((videoRef.current?.currentTime ?? 0) + direction / (frameRate && frameRate > 0 ? frameRate : 30));
  }, [seek, session]);

  const setMuted = useCallback((muted: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    session.updatePresentation({ muted });
  }, [session]);

  const setVolume = useCallback((volume: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, volume));
    if (video.volume > 0 && video.muted) video.muted = false;
    session.updatePresentation({ volume: video.volume, muted: video.muted });
  }, [session]);

  const readPlaybackQuality = useCallback((video: HTMLVideoElement): VideoPlaybackQualitySample => {
    if (typeof video.getVideoPlaybackQuality !== 'function') {
      return {
        sampledAtMilliseconds: performance.now(),
        totalFrames: 0,
        droppedFrames: 0
      };
    }
    const quality = video.getVideoPlaybackQuality();
    return {
      sampledAtMilliseconds: performance.now(),
      totalFrames: quality.totalVideoFrames,
      droppedFrames: quality.droppedVideoFrames
    };
  }, []);

  const stopPlaybackQualityMeasurement = useCallback(() => {
    if (playbackQualityTimerRef.current !== null) clearInterval(playbackQualityTimerRef.current);
    playbackQualityTimerRef.current = null;
    playbackQualityBaselineRef.current = null;
    const previous = session.getPlaybackTelemetrySnapshot();
    session.publishPlaybackTelemetry({ ...previous, status: 'idle', belowTarget: false });
  }, [session]);

  const startPlaybackQualityMeasurement = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playbackQualityTimerRef.current !== null) clearInterval(playbackQualityTimerRef.current);
    playbackQualityBaselineRef.current = readPlaybackQuality(video);
    const previous = session.getPlaybackTelemetrySnapshot();
    session.publishPlaybackTelemetry({ ...previous, status: 'warming', belowTarget: false });
    playbackQualityTimerRef.current = setInterval(() => {
      const currentVideo = videoRef.current;
      const baseline = playbackQualityBaselineRef.current;
      if (!currentVideo || currentVideo.paused || !baseline) return;
      const current = readPlaybackQuality(currentVideo);
      if (current.sampledAtMilliseconds - baseline.sampledAtMilliseconds < 900) return;
      const sourceFrameRate = session.getSnapshot().metadata?.frameRate;
      const retainedTarget = session.getPlaybackTelemetrySnapshot().targetFramesPerSecond;
      const expectedFramesPerSecond = sourceFrameRate && sourceFrameRate > 0
        ? sourceFrameRate * currentVideo.playbackRate
        : current.totalFrames === baseline.totalFrames ? retainedTarget : null;
      session.publishPlaybackTelemetry(measureVideoPlaybackTelemetry({
        baseline,
        current,
        expectedFramesPerSecond
      }));
      playbackQualityBaselineRef.current = current;
    }, 250);
  }, [readPlaybackQuality, session]);

  useImperativeHandle(forwardedRef, () => ({
    setZoomPercent: setZoomAtCenter,
    fit,
    actual,
    step,
    togglePlayback,
    seek,
    stepFrame,
    setMuted,
    setVolume
  }), [
    actual, fit, seek, setMuted, setVolume, setZoomAtCenter, step, stepFrame, togglePlayback
  ]);

  useEffect(() => {
    onZoomPercentChange?.(activeScale * 100);
  }, [activeScale, onZoomPercentChange]);

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

  const localPoint = (event: React.PointerEvent<HTMLElement> | React.WheelEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return clientToLocalPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top }
    );
  };

  const mediaRect = metadata ? resolveViewportImageRect(
    metadata.width,
    metadata.height,
    viewportSize.width,
    viewportSize.height,
    activeScale,
    view.panX,
    view.panY
  ) : null;

  return (
    <main
      ref={rootRef}
      className="lighttable-video-document"
      aria-label={`Video document ${file.name}`}
      data-active-tool={activeTool === 'view' || activeTool === 'zoom' ? activeTool : undefined}
      onWheel={(event) => {
        if (!metadata || event.defaultPrevented) return;
        event.preventDefault();
        const current = pendingViewRef.current ?? viewRef.current;
        const scale = current.zoomMode === 'custom' ? current.zoom
          : current.zoomMode === '100' ? 1 : fitScale;
        if (!zoomWithScrollWheel && !event.ctrlKey && !event.metaKey) {
          const native = event.nativeEvent as WheelEvent & { readonly wheelDeltaX?: number };
          const delta = resolveWheelPanDeltas({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            legacyWheelDeltaX: native.wheelDeltaX,
            shiftKey: event.shiftKey
          });
          const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportSize.height : 1;
          const pan = panViewFromWheel({
            initialView: current,
            deltaX: delta.deltaX,
            deltaY: delta.deltaY,
            deltaMultiplier: multiplier
          });
          scheduleView({ ...current, zoomMode: 'custom', zoom: scale, ...pan });
          return;
        }
        const next = zoomViewAtPoint({
          cursor: localPoint(event),
          viewport: viewportSize,
          view: { scale, panX: current.panX, panY: current.panY },
          wheelDelta: event.deltaY,
          minScale: 0.01,
          maxScale: 256
        });
        scheduleView({ zoomMode: 'custom', zoom: next.scale, panX: next.panX, panY: next.panY });
      }}
      onPointerDown={(event) => {
        if (!metadata || event.button !== 0 || (activeTool !== 'view' && activeTool !== 'zoom')) return;
        const point = localPoint(event);
        if (activeTool === 'view') {
          dragRef.current = {
            pointerId: event.pointerId,
            origin: { x: event.clientX, y: event.clientY },
            initialView: viewRef.current
          };
        } else {
          const documentPoint = mediaRect ? localToDocumentPointer(
            point,
            mediaRect,
            activeScale,
            metadata
          ) : null;
          if (!documentPoint) return;
          const zoomOut = zoomOutActive || event.altKey;
          zoomDragRef.current = { pointerId: event.pointerId, start: point, current: point, zoomOut };
          if (!zoomOut) setZoomDraft({ start: point, current: point });
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId) {
          const pan = panViewFromGesture({
            origin: drag.origin,
            current: { x: event.clientX, y: event.clientY },
            initialView: drag.initialView
          });
          scheduleView({ ...viewRef.current, zoomMode: 'custom', zoom: activeScale, ...pan });
          event.preventDefault();
          return;
        }
        const zoomDrag = zoomDragRef.current;
        if (zoomDrag?.pointerId === event.pointerId) {
          zoomDrag.current = localPoint(event);
          if (!zoomDrag.zoomOut) setZoomDraft({ start: zoomDrag.start, current: zoomDrag.current });
          event.preventDefault();
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          flushView();
          dragRef.current = null;
          event.preventDefault();
          return;
        }
        const zoomDrag = zoomDragRef.current;
        if (zoomDrag?.pointerId !== event.pointerId) return;
        zoomDragRef.current = null;
        setZoomDraft(null);
        const width = Math.abs(zoomDrag.current.x - zoomDrag.start.x);
        const height = Math.abs(zoomDrag.current.y - zoomDrag.start.y);
        if (zoomDrag.zoomOut || Math.hypot(width, height) < 5) {
          const percent = steppedZoomPercent(activeScale * 100, zoomDrag.zoomOut ? -1 : 1);
          const next = zoomViewToScaleAtPoint({
            cursor: zoomDrag.start,
            viewport: viewportSize,
            view: { scale: activeScale, panX: viewRef.current.panX, panY: viewRef.current.panY },
            scale: zoomPercentToScale(percent)
          });
          publishView({ zoomMode: 'custom', zoom: next.scale, panX: next.panX, panY: next.panY });
        } else {
          const next = zoomViewToViewportRect({
            rect: {
              x: Math.min(zoomDrag.start.x, zoomDrag.current.x),
              y: Math.min(zoomDrag.start.y, zoomDrag.current.y),
              width,
              height
            },
            viewport: viewportSize,
            view: { scale: activeScale, panX: viewRef.current.panX, panY: viewRef.current.panY },
            minScale: 0.01,
            maxScale: 256
          });
          publishView({ zoomMode: 'custom', zoom: next.scale, panX: next.panX, panY: next.panY });
        }
        event.preventDefault();
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        if (zoomDragRef.current?.pointerId === event.pointerId) zoomDragRef.current = null;
        setZoomDraft(null);
      }}
    >
      {sourceUrl ? (
        <video
          ref={videoRef}
          className="lighttable-video-document__media"
          src={sourceUrl}
          preload="metadata"
          controls={false}
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          style={mediaRect ? {
            width: `${mediaRect.width}px`,
            height: `${mediaRect.height}px`,
            transform: `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px)`
          } : undefined}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const nextMetadata = {
              width: video.videoWidth,
              height: video.videoHeight,
              durationSeconds: Number.isFinite(video.duration) ? video.duration : 0
            };
            metadataRef.current = nextMetadata;
            setMetadata(nextMetadata);
            session.publishReady(nextMetadata);
            const presentation = session.getSnapshot().presentation;
            video.currentTime = presentation.currentTimeSeconds;
            video.muted = presentation.muted;
            video.volume = presentation.volume;
            video.playbackRate = presentation.playbackRate;
            session.publishPlaybackTelemetry({
              status: 'idle',
              actualFramesPerSecond: null,
              targetFramesPerSecond: null,
              droppedFrames: 0,
              belowTarget: false
            });
          }}
          onTimeUpdate={(event) => session.updatePresentation({ currentTimeSeconds: event.currentTarget.currentTime })}
          onSeeked={(event) => session.updatePresentation({ currentTimeSeconds: event.currentTarget.currentTime })}
          onPlay={() => {
            session.updatePresentation({ paused: false });
            startPlaybackQualityMeasurement();
          }}
          onPause={() => {
            session.updatePresentation({ paused: true });
            stopPlaybackQualityMeasurement();
          }}
          onVolumeChange={(event) => session.updatePresentation({
            muted: event.currentTarget.muted,
            volume: event.currentTarget.volume
          })}
          onRateChange={(event) => session.updatePresentation({ playbackRate: event.currentTarget.playbackRate })}
          onError={() => session.publishFailure('Video could not be decoded by this LightTable build.')}
        />
      ) : null}
      {zoomDraft ? (
        <div
          className="lighttable-video-document__zoom-draft"
          style={{
            left: Math.min(zoomDraft.start.x, zoomDraft.current.x),
            top: Math.min(zoomDraft.start.y, zoomDraft.current.y),
            width: Math.abs(zoomDraft.current.x - zoomDraft.start.x),
            height: Math.abs(zoomDraft.current.y - zoomDraft.start.y)
          }}
        />
      ) : null}
    </main>
  );
});

VideoDocumentSurface.displayName = 'VideoDocumentSurface';
