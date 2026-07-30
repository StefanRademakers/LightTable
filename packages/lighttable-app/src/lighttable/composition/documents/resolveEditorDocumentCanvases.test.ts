import { describe, expect, it } from 'vitest';
import type { RefObject } from 'react';
import {
  resolveEditorDocumentCanvases,
  type EditorDocumentScopeCanvasRefs
} from './resolveEditorDocumentCanvases';

const ref = (
  current: HTMLCanvasElement | null
): RefObject<HTMLCanvasElement | null> => ({ current });

const canvas = (name: string) => ({ name } as unknown as HTMLCanvasElement);

describe('resolveEditorDocumentCanvases', () => {
  it('refuses to start a document generation until every surface exists', () => {
    const refs: EditorDocumentScopeCanvasRefs = {
      viewport: ref(canvas('viewport')),
      hueDistribution: ref(canvas('hue')),
      colorMixerHueDistribution: ref(null),
      parade: ref(canvas('parade')),
      vectorscope: ref(canvas('vectorscope'))
    };

    expect(resolveEditorDocumentCanvases(refs)).toBeNull();
  });

  it('projects viewport and scope surfaces into their renderer contracts', () => {
    const viewport = canvas('viewport');
    const hue = canvas('hue');
    const mixer = canvas('mixer');
    const parade = canvas('parade');
    const vectorscope = canvas('vectorscope');
    const refs: EditorDocumentScopeCanvasRefs = {
      viewport: ref(viewport),
      hueDistribution: ref(hue),
      colorMixerHueDistribution: ref(mixer),
      parade: ref(parade),
      vectorscope: ref(vectorscope)
    };

    expect(resolveEditorDocumentCanvases(refs)).toEqual({
      viewport,
      scopes: {
        hueDistribution: hue,
        colorMixerHueDistribution: mixer,
        parade,
        vectorscope
      }
    });
  });
});
