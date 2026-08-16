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
  it('starts without the optional contextual color-mixer surface', () => {
    const viewport = canvas('viewport');
    const hue = canvas('hue');
    const parade = canvas('parade');
    const vectorscope = canvas('vectorscope');
    const refs: EditorDocumentScopeCanvasRefs = {
      viewport: ref(viewport),
      hueDistribution: ref(hue),
      colorMixerHueDistribution: ref(null),
      parade: ref(parade),
      vectorscope: ref(vectorscope)
    };

    expect(resolveEditorDocumentCanvases(refs)).toEqual({
      viewport,
      scopes: { hueDistribution: hue, parade, vectorscope }
    });
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
