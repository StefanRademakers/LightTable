import {
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  createPositionedTextFixture
} from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayer, setLayerLock } from './documentCommands';
import { createImageDocument } from './documentTypes';
import { findDocumentLayer } from './layerTree';
import {
  setFlowTextContent,
  setFlowTextLayout,
  setFlowTextRuns,
  setPositionedTextRuns,
  setTextLayerTransform
} from './textLayerCommands';
import { translationMatrix } from '../geometry/affine';

const flowDocument = () => createTextLayer(
  createImageDocument('Text commands', 320, 200, 'background'),
  createDefaultTextLayerData(),
  'Headline'
);

const activeText = (document: ReturnType<typeof flowDocument>) => {
  const layer = findDocumentLayer(document, document.activeLayerId);
  if (layer?.type !== 'text') throw new Error('Expected text fixture.');
  return layer;
};

describe('canonical text layer commands', () => {
  it('changes flow content and its UTF-16 runs atomically', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const nextSource = createDefaultFlowTextSource('Hello 👋');
    const changed = setFlowTextContent(
      document,
      id,
      nextSource.text,
      nextSource.styleRuns,
      nextSource.paragraphRuns
    );
    const text = activeText(changed);

    expect(text.id).toBe(id);
    expect(text.text.source).toEqual(nextSource);
    expect(text.text.revisions).toEqual({
      content: 1,
      style: 1,
      layout: 1,
      path: 0,
      geometry: 0
    });
    expect(setFlowTextContent(
      changed,
      id,
      nextSource.text,
      nextSource.styleRuns,
      nextSource.paragraphRuns
    )).toBe(changed);
  });

  it('tracks style, layout, path and common geometry revisions independently', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const styledRuns = source.styleRuns.map((run) => ({ ...run, fontSize: 24 }));
    const styled = setFlowTextRuns(document, id, styledRuns, source.paragraphRuns);
    const paragraph = setFlowTextLayout(styled, id, {
      mode: 'paragraph',
      frame: { x: 10, y: 20, width: 180, height: 90 },
      overflow: 'indicator',
      writingMode: 'horizontal-tb'
    });
    const path = setFlowTextLayout(paragraph, id, {
      mode: 'path',
      pathLayerId: 'path-layer',
      startOffset: 4,
      side: 'left',
      upright: true
    });
    const transformed = setTextLayerTransform(path, id, translationMatrix(7, -3));
    const text = activeText(transformed);

    expect(text.text.revisions).toEqual({
      content: 0,
      style: 1,
      layout: 2,
      path: 1,
      geometry: 3
    });
    expect(text.geometryRevision).toBe(1);
    expect(text.transform).toEqual(translationMatrix(7, -3));
  });

  it('invalidates layout but not character style for paragraph-only run changes', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const paragraphs = source.paragraphRuns.map((run) => ({
      ...run,
      alignment: 'center' as const
    }));

    const changed = setFlowTextRuns(document, id, source.styleRuns, paragraphs);

    expect(activeText(changed).text.revisions).toMatchObject({
      content: 0,
      style: 0,
      layout: 1
    });
  });

  it('keeps positioned text out of flow commands and validates positioned runs', () => {
    const document = createTextLayer(
      createImageDocument('Positioned', 320, 200, 'background'),
      createPositionedTextFixture(),
      'PDF text'
    );
    const id = document.activeLayerId!;
    const text = activeText(document);
    if (text.text.source.kind !== 'positioned') throw new Error('Expected positioned text.');

    expect(setFlowTextLayout(document, id, createDefaultFlowTextSource().layout)).toBe(document);
    const runs = text.text.source.runs.map((run) => ({
      ...run,
      glyphs: run.glyphs.map((glyph) => ({ ...glyph, x: glyph.x + 2 }))
    }));
    const changed = setPositionedTextRuns(document, id, runs);

    expect(activeText(changed).text.revisions).toMatchObject({
      content: 1,
      style: 1,
      geometry: 1
    });
  });

  it('rejects invalid runs and respects pixel and position locks', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const invalidRuns = source.styleRuns.map((run) => ({ ...run, end: 999 }));

    expect(() => setFlowTextRuns(document, id, invalidRuns, source.paragraphRuns))
      .toThrow(/styleRuns/);

    const pixelLocked = setLayerLock(document, id, 'pixels', true);
    expect(setFlowTextRuns(pixelLocked, id, source.styleRuns, source.paragraphRuns))
      .toBe(pixelLocked);
    const positionLocked = setLayerLock(document, id, 'position', true);
    expect(setTextLayerTransform(positionLocked, id, translationMatrix(10, 10)))
      .toBe(positionLocked);
  });
});
