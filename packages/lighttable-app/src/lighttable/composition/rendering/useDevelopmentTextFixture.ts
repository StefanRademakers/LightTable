import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface DevelopmentTextFixtureSnapshot {
  readonly enabled: boolean;
  readonly status: 'off' | 'preparing' | 'ready' | 'error';
  readonly error: string | null;
}

export interface DevelopmentTextFixtureRenderer {
  setDevelopmentTextFixtureEnabled(enabled: boolean): Promise<DevelopmentTextFixtureSnapshot>;
}

export const useDevelopmentTextFixture = ({
  getRenderer,
  rendererIdentity,
  report
}: {
  readonly getRenderer: () => DevelopmentTextFixtureRenderer | null;
  readonly rendererIdentity: object | string | number;
  readonly report: (severity: 'info' | 'error', title: string, detail: string) => void;
}) => {
  const latest = useRef({ getRenderer, report });
  latest.current = { getRenderer, report };
  const generationRef = useRef(0);
  const enabledRendererRef = useRef<DevelopmentTextFixtureRenderer | null>(null);
  const [snapshot, setSnapshot] = useState<DevelopmentTextFixtureSnapshot>({
    enabled: false,
    status: 'off',
    error: null
  });

  useLayoutEffect(() => {
    generationRef.current += 1;
    setSnapshot({ enabled: false, status: 'off', error: null });
    const renderer = latest.current.getRenderer();
    return () => {
      generationRef.current += 1;
      if (renderer && enabledRendererRef.current === renderer) {
        enabledRendererRef.current = null;
        void renderer.setDevelopmentTextFixtureEnabled(false);
      }
    };
  }, [rendererIdentity]);

  const setEnabled = useCallback((enabled: boolean) => {
    const generation = ++generationRef.current;
    const renderer = latest.current.getRenderer();
    if (!enabled) {
      setSnapshot({ enabled: false, status: 'off', error: null });
      const enabledRenderer = enabledRendererRef.current;
      enabledRendererRef.current = null;
      if (enabledRenderer) void enabledRenderer.setDevelopmentTextFixtureEnabled(false);
      latest.current.report('info', 'GPU text canvas fixture', 'Disabled.');
      return;
    }
    if (!import.meta.env.DEV || !renderer) {
      const error = !import.meta.env.DEV
        ? 'The canvas text fixture is available only in development builds.'
        : 'Open a document before enabling the canvas text fixture.';
      setSnapshot({ enabled: false, status: 'error', error });
      latest.current.report('error', 'GPU text canvas fixture', error);
      return;
    }
    setSnapshot({ enabled: true, status: 'preparing', error: null });
    enabledRendererRef.current = renderer;
    void renderer.setDevelopmentTextFixtureEnabled(true).then((next) => {
      if (generation !== generationRef.current || latest.current.getRenderer() !== renderer) return;
      setSnapshot(next);
      latest.current.report('info', 'GPU text canvas fixture', 'Ready on the real rgba16float canvas path.');
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current || latest.current.getRenderer() !== renderer) return;
      enabledRendererRef.current = null;
      const error = reason instanceof Error ? reason.message : 'The canvas text fixture could not be prepared.';
      setSnapshot({ enabled: false, status: 'error', error });
      latest.current.report('error', 'GPU text canvas fixture', error);
    });
  }, []);

  return { snapshot, setEnabled } as const;
};
