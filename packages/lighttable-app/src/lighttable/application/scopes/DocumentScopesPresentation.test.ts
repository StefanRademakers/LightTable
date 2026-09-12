import { describe, expect, it, vi } from 'vitest';
import type { InputAnimationFrameHost } from '../input/latestFrameValueScheduler';
import { DEFAULT_SCOPE_SETTINGS, DEFAULT_SCOPE_VISIBILITY } from '../../scopes';
import { DocumentScopesPresentation } from './DocumentScopesPresentation';

const frameFixture = () => {
  let callback: FrameRequestCallback | null = null;
  const host: InputAnimationFrameHost = {
    request: vi.fn(next => {
      callback = next;
      return 1;
    }),
    cancel: vi.fn(() => {
      callback = null;
    })
  };
  return {
    host,
    flush: () => {
      const next = callback;
      callback = null;
      next?.(0);
    }
  };
};

describe('DocumentScopesPresentation', () => {
  it('keeps settings and visibility in one synchronously readable owner', () => {
    const presentation = new DocumentScopesPresentation(frameFixture().host);
    const listener = vi.fn();
    presentation.subscribe(listener);

    presentation.setSettings({ ...DEFAULT_SCOPE_SETTINGS, quality: 'high' });
    presentation.setVisibility('vectorscope', false);

    expect(presentation.getSnapshot()).toMatchObject({
      settings: { quality: 'high' },
      visibility: { vectorscope: false }
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('coalesces histogram publication and clears pending work on reset', () => {
    const frame = frameFixture();
    const presentation = new DocumentScopesPresentation(frame.host);
    const first = { red: new Uint32Array([1]), green: new Uint32Array([2]), blue: new Uint32Array([3]) };
    const latest = { red: new Uint32Array([4]), green: new Uint32Array([5]), blue: new Uint32Array([6]) };

    presentation.publishHistogram(first);
    presentation.publishHistogram(latest);
    expect(presentation.getSnapshot().histogram).toBeNull();
    frame.flush();
    expect(presentation.getSnapshot().histogram).toBe(latest);

    presentation.publishHistogram(first);
    presentation.reset(DEFAULT_SCOPE_SETTINGS, DEFAULT_SCOPE_VISIBILITY);
    frame.flush();
    expect(presentation.getSnapshot()).toEqual({
      settings: DEFAULT_SCOPE_SETTINGS,
      visibility: DEFAULT_SCOPE_VISIBILITY,
      histogram: null,
      error: null
    });
  });

  it('remains usable after a Strict Mode style disconnect and reconnect', () => {
    const frame = frameFixture();
    const presentation = new DocumentScopesPresentation(frame.host);
    const histogram = { red: new Uint32Array([7]), green: new Uint32Array([8]), blue: new Uint32Array([9]) };

    presentation.publishHistogram(histogram);
    presentation.disconnect();
    frame.flush();
    expect(presentation.getSnapshot().histogram).toBeNull();

    presentation.publishHistogram(histogram);
    frame.flush();
    expect(presentation.getSnapshot().histogram).toBe(histogram);
  });
});
