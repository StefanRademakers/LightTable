import { audioIconUrl, MaskIcon, photoIconUrl, videoIconUrl } from '@mediavibe/ui';
import type { GenAiAssetReference } from '@lighttable/genai-core';
import React from 'react';

export interface ProjectAssetMediaSource {
  readonly url: string;
  readonly byteLength: number;
  release(): void;
}

export interface ProjectAssetPreviewProps {
  readonly asset: GenAiAssetReference;
  readonly thumbnail?: string;
  readonly requestMediaSource?: (asset: GenAiAssetReference) => Promise<ProjectAssetMediaSource | null>;
}

let activeScrubMedia: HTMLMediaElement | undefined;
const claimScrubAudio = (media: HTMLMediaElement) => {
  if (activeScrubMedia !== media) activeScrubMedia?.pause();
  activeScrubMedia = media;
};
const releaseScrubAudio = (media: HTMLMediaElement | null) => {
  if (activeScrubMedia === media) activeScrubMedia = undefined;
};

const mediaKind = (mediaType: string): 'image' | 'video' | 'audio' | 'other' => mediaType.startsWith('image/')
  ? 'image' : mediaType.startsWith('video/') ? 'video' : mediaType.startsWith('audio/') ? 'audio' : 'other';

export const projectAssetPreviewBadge = (mediaType: string) => {
  const kind = mediaKind(mediaType);
  const source = kind === 'video' ? videoIconUrl : kind === 'audio' ? audioIconUrl : photoIconUrl;
  return <MaskIcon src={source} />;
};

const fallbackWaveform = [0.22, 0.46, 0.31, 0.72, 0.38, 0.84, 0.54, 0.29, 0.61, 0.42, 0.77, 0.34,
  0.58, 0.25, 0.68, 0.49, 0.82, 0.37, 0.64, 0.28, 0.53, 0.73, 0.41, 0.24];

const decodeWaveform = async (source: ProjectAssetMediaSource): Promise<readonly number[] | null> => {
  if (source.byteLength > 32 * 1024 * 1024) return null;
  const response = await fetch(source.url);
  if (!response.ok) return null;
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const bins = 48;
    return Array.from({ length: bins }, (_, index) => {
      const from = Math.floor(index * channel.length / bins);
      const to = Math.max(from + 1, Math.floor((index + 1) * channel.length / bins));
      let peak = 0;
      for (let cursor = from; cursor < to; cursor += Math.max(1, Math.floor((to - from) / 96))) {
        peak = Math.max(peak, Math.abs(channel[cursor] ?? 0));
      }
      return Math.max(0.08, peak);
    });
  } catch {
    return null;
  } finally {
    void context.close();
  }
};

const ScrubbableMediaPreview = ({ asset, thumbnail, requestMediaSource, kind }: ProjectAssetPreviewProps & {
  readonly kind: 'video' | 'audio';
}) => {
  const media = React.useRef<HTMLMediaElement>(null);
  const releaseTimer = React.useRef<number | undefined>(undefined);
  const pauseTimer = React.useRef<number | undefined>(undefined);
  const requestGeneration = React.useRef(0);
  const pendingGeneration = React.useRef<number | undefined>(undefined);
  const sourceRef = React.useRef<ProjectAssetMediaSource | undefined>(undefined);
  const [source, setSource] = React.useState<ProjectAssetMediaSource>();
  const [position, setPosition] = React.useState(0);
  const [waveform, setWaveform] = React.useState<readonly number[]>(fallbackWaveform);

  const stop = React.useCallback(() => {
    if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
    pauseTimer.current = undefined;
    media.current?.pause();
    releaseScrubAudio(media.current);
  }, []);

  const release = React.useCallback(() => {
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    releaseTimer.current = undefined;
    requestGeneration.current += 1;
    pendingGeneration.current = undefined;
    stop();
    sourceRef.current?.release();
    sourceRef.current = undefined;
    setSource(undefined);
  }, [stop]);

  React.useEffect(() => () => {
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    requestGeneration.current += 1;
    pendingGeneration.current = undefined;
    stop();
    sourceRef.current?.release();
    sourceRef.current = undefined;
  }, [stop]);

  const ensureSource = React.useCallback(async () => {
    if (sourceRef.current || pendingGeneration.current !== undefined || !requestMediaSource) return;
    const generation = ++requestGeneration.current;
    pendingGeneration.current = generation;
    try {
      const next = await requestMediaSource(asset).catch(() => null);
      if (!next) return;
      if (generation !== requestGeneration.current) return next.release();
      sourceRef.current = next;
      setSource(next);
      if (kind === 'audio') void decodeWaveform(next).then((peaks) => {
        if (peaks && generation === requestGeneration.current) setWaveform(peaks);
      });
    } finally {
      if (pendingGeneration.current === generation) pendingGeneration.current = undefined;
    }
  }, [asset, kind, requestMediaSource]);

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    void ensureSource();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setPosition(ratio);
    const element = media.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    const nextTime = Math.min(element.duration - 0.03, ratio * element.duration);
    if (Math.abs(element.currentTime - nextTime) > 0.025) element.currentTime = nextTime;
    claimScrubAudio(element);
    void element.play().catch(() => undefined);
    if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
    pauseTimer.current = window.setTimeout(stop, 120);
  };

  return <div className={`project-asset-preview project-asset-preview--${kind}`}
    onPointerEnter={() => { if (releaseTimer.current) window.clearTimeout(releaseTimer.current); void ensureSource(); }}
    onPointerMove={scrub}
    onPointerLeave={() => {
      stop();
      releaseTimer.current = window.setTimeout(release, 180);
    }}>
    {kind === 'video' ? <video ref={media as React.RefObject<HTMLVideoElement>} src={source?.url}
      poster={thumbnail} preload="metadata" playsInline /> : <>
      <audio ref={media as React.RefObject<HTMLAudioElement>} src={source?.url} preload="metadata" />
      <div className="project-asset-preview__waveform" aria-hidden="true">
        {waveform.map((peak, index) => <i key={index} style={{ height: `${Math.round(peak * 86)}%` }} />)}
      </div>
    </>}
    <span className="project-asset-preview__playhead" style={{ left: `${position * 100}%` }} aria-hidden="true" />
  </div>;
};

export const ProjectAssetPreview = (props: ProjectAssetPreviewProps) => {
  const kind = mediaKind(props.asset.mediaType);
  if (kind === 'video' || kind === 'audio') return <ScrubbableMediaPreview {...props} kind={kind} />;
  return <div className="project-asset-preview project-asset-preview--image">
    {props.thumbnail ? <img src={props.thumbnail} alt="" draggable={false} /> : <span>{kind === 'image' ? 'Image' : 'File'}</span>}
  </div>;
};
