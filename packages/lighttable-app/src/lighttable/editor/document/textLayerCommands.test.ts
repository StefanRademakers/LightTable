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
  convertParagraphTextToPoint,
  convertPointTextToParagraph,
  recoverPositionedTextAsFlow,
  setFlowTextContent,
  setFlowTextLayout,
  setFlowTextRuns,
  setPositionedTextRuns,
  setTextLayerTransform
} from './textLayerCommands';
import { multiplyMatrices, rotationMatrix, translationMatrix } from '../geometry/affine';

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
      font: 0,
      layout: 0,
      paint: 0,
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

  it('isolates a subrange paint edit from font and layout revisions', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const original = source.styleRuns[0];
    const changed = setFlowTextContent(document, id, source.text, [
      { ...original, start: 0, end: 2 },
      { ...original, start: 2, end: source.text.length, fill: {
        kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 }
      } }
    ], source.paragraphRuns);
    expect(activeText(changed).text.revisions).toEqual({
      content: 0, font: 0, layout: 0, paint: 1, path: 0, geometry: 0
    });
  });

  it('replaces and clears persisted insertion state explicitly', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const { start: _start, end: _end, ...insertionStyle } = source.styleRuns[0];
    const seeded = setFlowTextContent(
      document, id, source.text, source.styleRuns, source.paragraphRuns,
      { insertionStyle: { ...insertionStyle, fontSize: 42 } }
    );
    expect(activeText(seeded).text.source).toMatchObject({
      insertionStyle: { fontSize: 42 }
    });
    const seededSource = activeText(seeded).text.source;
    if (seededSource.kind !== 'flow') throw new Error('Expected flow text.');
    const cleared = setFlowTextContent(
      seeded, id, seededSource.text, seededSource.styleRuns, seededSource.paragraphRuns, {}
    );
    expect('insertionStyle' in activeText(cleared).text.source).toBe(false);
  });

  it('does not revise content when feature and axis key order changes', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const styled = setFlowTextContent(document, id, source.text, source.styleRuns.map((run) => ({
      ...run,
      openTypeFeatures: { liga: true, kern: false },
      variableAxes: { wght: 400, wdth: 100 }
    })), source.paragraphRuns);
    const styledSource = activeText(styled).text.source;
    if (styledSource.kind !== 'flow') throw new Error('Expected flow text.');
    const reordered = setFlowTextContent(styled, id, styledSource.text, styledSource.styleRuns.map((run) => ({
      ...run,
      openTypeFeatures: { kern: false, liga: true },
      variableAxes: { wdth: 100, wght: 400 }
    })), styledSource.paragraphRuns);
    expect(reordered).toBe(styled);
  });

  it('tracks font, layout, path and common geometry revisions independently', () => {
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
      pathElementId: 'path-element',
      pathSubpathId: 'path-subpath',
      startOffset: 4,
      endOffset: 96,
      direction: 'reverse',
      side: 'left',
      upright: true
    });
    const transformed = setTextLayerTransform(path, id, translationMatrix(7, -3));
    const text = activeText(transformed);

    expect(text.text.revisions).toEqual({
      content: 0,
      font: 1,
      layout: 2,
      paint: 0,
      path: 1,
      geometry: 2
    });
    expect(text.geometryRevision).toBe(1);
    expect(text.transform).toEqual(translationMatrix(7, -3));
  });

  it('converts point and paragraph geometry without changing authored text or layer transform', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const anchored = setFlowTextLayout(document, id, {
      mode: 'point',
      origin: { x: 8, y: 11 },
      writingMode: 'horizontal-tb'
    });
    const positioned = setTextLayerTransform(anchored, id, translationMatrix(37, 19));
    const before = activeText(positioned);
    if (before.text.source.kind !== 'flow' || before.text.source.layout.mode !== 'point') {
      throw new Error('Expected point text.');
    }
    const authored = {
      text: before.text.source.text,
      styleRuns: before.text.source.styleRuns,
      paragraphRuns: before.text.source.paragraphRuns
    };

    const paragraph = convertPointTextToParagraph(positioned, id, {
      width: 144,
      height: 72,
      firstBaselineOffset: 47
    });
    const paragraphLayer = activeText(paragraph);
    expect(paragraphLayer.transform).toEqual(before.transform);
    expect(paragraphLayer.text.source).toMatchObject({
      ...authored,
      layout: {
        mode: 'paragraph',
        frame: { x: 8, y: -36, width: 144, height: 72 },
        overflow: 'indicator',
        writingMode: 'horizontal-tb'
      }
    });
    expect(paragraphLayer.text.revisions).toMatchObject({ layout: 2, geometry: 2 });
    expect(paragraphLayer.geometryRevision).toBe(before.geometryRevision);

    const point = convertParagraphTextToPoint(paragraph, id, { firstBaselineOffset: 47 });
    const pointLayer = activeText(point);
    expect(pointLayer.transform).toEqual(before.transform);
    expect(pointLayer.text.source).toMatchObject({
      ...authored,
      layout: {
        mode: 'point',
        origin: { x: 8, y: 11 },
        writingMode: 'horizontal-tb'
      }
    });
    expect(pointLayer.text.revisions).toMatchObject({ layout: 3, geometry: 3 });
  });

  it('rejects unusable conversion frames and respects position locks', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    expect(() => convertPointTextToParagraph(document, id, { width: 0, height: 20 }))
      .toThrow(/finite positive/);
    expect(() => convertPointTextToParagraph(document, id, { width: 20, height: Infinity }))
      .toThrow(/finite positive/);
    const locked = setLayerLock(document, id, 'position', true);
    expect(convertPointTextToParagraph(locked, id, { width: 120, height: 80 }))
      .toBe(locked);
  });

  it('invalidates layout but not font or paint for paragraph-only run changes', () => {
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
      font: 0,
      paint: 0,
      layout: 1
    });
  });

  it('keeps paint-only edits out of the font and layout domains', () => {
    const document = flowDocument();
    const id = document.activeLayerId!;
    const source = activeText(document).text.source;
    if (source.kind !== 'flow') throw new Error('Expected flow text.');
    const paintedRuns = source.styleRuns.map((run) => ({
      ...run,
      fill: {
        kind: 'solid' as const,
        color: { colorSpace: 'srgb' as const, r: 1, g: 0, b: 0, a: 1 }
      }
    }));

    const changed = setFlowTextRuns(document, id, paintedRuns, source.paragraphRuns);

    expect(activeText(changed).text.revisions).toMatchObject({
      content: 0,
      font: 0,
      layout: 0,
      paint: 1,
      geometry: 0
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
      content: 0,
      font: 0,
      paint: 0,
      geometry: 1
    });
  });

  it('recovers positioned text atomically and composes its rotation after the common transform', () => {
    const data = createPositionedTextFixture();
    if (data.source.kind !== 'positioned') throw new Error('Expected positioned text.');
    const positionedData = {
      ...data,
      source: {
        ...data.source,
        editability: 'recoverable' as const,
        runs: data.source.runs.map(run => ({
          ...run,
          textMatrix: [0, -24, 40, 24, 0, 50, 0, 0, 1] as const,
          glyphs: run.glyphs.map(glyph => ({ ...glyph, advanceX: 0.6 }))
        }))
      }
    };
    const document = createTextLayer(
      createImageDocument('Recovery', 320, 200, 'background'),
      positionedData,
      'PDF text'
    );
    const id = document.activeLayerId!;
    const placed = setTextLayerTransform(document, id, translationMatrix(30, 10));
    const changed = recoverPositionedTextAsFlow(placed, id);
    const recovered = activeText(changed);

    expect(recovered.text.source).toMatchObject({
      kind: 'flow', text: 'A',
      layout: { mode: 'point', origin: { x: 50, y: -40 } }
    });
    expect(recovered.transform).toEqual(multiplyMatrices(
      translationMatrix(30, 10), rotationMatrix(Math.PI / 2)
    ));
    expect(recovered.text.revisions).toEqual({
      content: 1, font: 1, layout: 1, paint: 1, path: 0, geometry: 1
    });
    expect(recovered.geometryRevision).toBe(activeText(placed).geometryRevision + 1);
    expect(changed.revision).toBe(placed.revision + 1);
    expect(recoverPositionedTextAsFlow(changed, id)).toBe(changed);
  });

  it('refuses blocked recovery and respects pixel and rotation position locks', () => {
    const document = createTextLayer(
      createImageDocument('Recovery locks', 320, 200, 'background'),
      createPositionedTextFixture(),
      'PDF text'
    );
    const id = document.activeLayerId!;
    const pixelLocked = setLayerLock(document, id, 'pixels', true);
    expect(recoverPositionedTextAsFlow(pixelLocked, id)).toBe(pixelLocked);

    const layer = activeText(document);
    if (layer.text.source.kind !== 'positioned') throw new Error('Expected positioned text.');
    const rotated = setPositionedTextRuns(document, id, layer.text.source.runs.map(run => ({
      ...run,
      textMatrix: [0, -20, 0, 20, 0, 0, 0, 0, 1] as const
    })));
    const positionLocked = setLayerLock(rotated, id, 'position', true);
    expect(recoverPositionedTextAsFlow(positionLocked, id)).toBe(positionLocked);

    const outlineOnly = {
      ...layer.text,
      source: { ...layer.text.source, editability: 'outline-only' as const }
    };
    const blocked = createTextLayer(
      createImageDocument('Blocked', 100, 100, 'asset'), outlineOnly, 'Outline text'
    );
    expect(recoverPositionedTextAsFlow(blocked, blocked.activeLayerId!)).toBe(blocked);
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
