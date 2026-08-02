import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useTextEngineDiagnostics } from './useTextEngineDiagnostics';

describe('text diagnostics lazy integration', () => {
  it('does not construct a worker or load text assets during an ordinary render', () => {
    const WorkerConstructor = vi.fn();
    vi.stubGlobal('Worker', WorkerConstructor);
    let status: string | undefined;

    const Harness = () => {
      const diagnostics = useTextEngineDiagnostics(vi.fn());
      status = diagnostics.state.status;
      return <span>{diagnostics.state.summary}</span>;
    };

    const markup = renderToStaticMarkup(<Harness />);

    expect(status).toBe('idle');
    expect(markup).toContain('worker and WASM remain lazy');
    expect(WorkerConstructor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
