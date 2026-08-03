import { describe, expect, it, vi } from 'vitest';
import { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';
import { bindRendererTextFontRuntime } from './bindRendererTextFontRuntime';

const port = (revision: number): TextFontRuntimePort => ({
  revision,
  assets: [],
  bytes: vi.fn(async () => null),
  subscribe: vi.fn(() => () => undefined)
});

describe('bindRendererTextFontRuntime', () => {
  it('replaces an obsolete open-time port on an already published renderer', () => {
    const lifecycle = new DocumentRendererLifecycle();
    const configureTextFonts = vi.fn();
    let renderer: { configureTextFonts: typeof configureTextFonts } | null = null;
    const openTimePort = port(0);
    const documentPort = port(1);
    const generation = lifecycle.beginStart();
    const detachOpenTime = bindRendererTextFontRuntime(
      lifecycle,
      () => renderer as never,
      openTimePort
    );

    renderer = { configureTextFonts };
    lifecycle.markReady(generation);
    expect(configureTextFonts).toHaveBeenLastCalledWith(openTimePort);

    detachOpenTime();
    const detachDocument = bindRendererTextFontRuntime(
      lifecycle,
      () => renderer as never,
      documentPort
    );
    expect(configureTextFonts).toHaveBeenLastCalledWith(documentPort);
    expect(configureTextFonts).toHaveBeenCalledTimes(2);
    detachDocument();
  });
});
