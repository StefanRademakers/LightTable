import { describe, expect, it } from 'vitest';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  panViewFromGesture,
  panViewFromWheel,
  pointInsideRect,
  zoomViewAtPoint,
  zoomViewToViewportRect,
  zoomViewToScaleAtPoint
} from './viewportCoordinates';

describe('viewportCoordinates', () => {
  it('projects client coordinates into document space', () => {
    const local = clientToLocalPoint(
      { x: 350, y: 240 },
      { x: 100, y: 40 }
    );
    expect(local).toEqual({ x: 250, y: 200 });
    expect(localToDocumentPointer(
      local,
      { x: 50, y: 20, width: 400, height: 300 },
      2,
      { width: 200, height: 150 },
      0.5
    )).toEqual({ x: 100, y: 90, pressure: 0.5 });
  });

  it('rejects points outside the document and normalizes missing pressure', () => {
    expect(localToDocumentPointer(
      { x: 9, y: 20 },
      { x: 10, y: 20, width: 100, height: 100 },
      1,
      { width: 100, height: 100 }
    )).toBeNull();
    expect(localToDocumentPointer(
      { x: 10, y: 20 },
      { x: 10, y: 20, width: 100, height: 100 },
      1,
      { width: 100, height: 100 },
      0
    )?.pressure).toBe(1);
  });

  it('preserves pasteboard coordinates for a captured document gesture', () => {
    expect(localToDocumentPointer(
      { x: -15, y: 135 },
      { x: 25, y: 35, width: 200, height: 100 },
      2,
      { width: 100, height: 50 },
      1,
      true
    )).toEqual({ x: -20, y: 50, pressure: 1 });
  });

  it('keeps the document point below the cursor stable while zooming', () => {
    const before = {
      scale: 1,
      panX: 20,
      panY: -10
    };
    const cursor = { x: 300, y: 180 };
    const viewport = { width: 800, height: 600 };
    const imagePoint = {
      x: (cursor.x - viewport.width / 2 - before.panX) / before.scale,
      y: (cursor.y - viewport.height / 2 - before.panY) / before.scale
    };
    const after = zoomViewAtPoint({
      cursor,
      viewport,
      view: before,
      wheelDelta: -120,
      minScale: 0.02,
      maxScale: 16
    });
    expect(
      viewport.width / 2 + after.panX + imagePoint.x * after.scale
    ).toBeCloseTo(cursor.x);
    expect(
      viewport.height / 2 + after.panY + imagePoint.y * after.scale
    ).toBeCloseTo(cursor.y);
  });

  it('clamps zoom and calculates pan gestures', () => {
    expect(zoomViewAtPoint({
      cursor: { x: 0, y: 0 },
      viewport: { width: 100, height: 100 },
      view: { scale: 1, panX: 0, panY: 0 },
      wheelDelta: -100_000,
      minScale: 0.5,
      maxScale: 2
    }).scale).toBe(2);
    expect(panViewFromGesture({
      origin: { x: 10, y: 20 },
      current: { x: 30, y: 15 },
      initialView: { panX: 4, panY: 8 }
    })).toEqual({ panX: 24, panY: 3 });
  });

  it('pans with a scroll wheel and maps Shift-wheel to horizontal movement', () => {
    expect(panViewFromWheel({
      initialView: { panX: 20, panY: 10 },
      deltaX: 3,
      deltaY: 8
    })).toEqual({ panX: 17, panY: 2 });
    expect(panViewFromWheel({
      initialView: { panX: 20, panY: 10 },
      deltaX: 0,
      deltaY: 2,
      shiftKey: true,
      deltaMultiplier: 16
    })).toEqual({ panX: -12, panY: 10 });
  });

  it('targets an exact zoom while preserving the point under the cursor', () => {
    const before = { scale: 1.5, panX: 12, panY: -8 };
    const cursor = { x: 220, y: 140 };
    const viewport = { width: 640, height: 480 };
    const imagePoint = {
      x: (cursor.x - viewport.width / 2 - before.panX) / before.scale,
      y: (cursor.y - viewport.height / 2 - before.panY) / before.scale
    };
    const after = zoomViewToScaleAtPoint({
      cursor,
      viewport,
      view: before,
      scale: 4
    });
    expect(after.scale).toBe(4);
    expect(viewport.width / 2 + after.panX + imagePoint.x * after.scale)
      .toBeCloseTo(cursor.x);
    expect(viewport.height / 2 + after.panY + imagePoint.y * after.scale)
      .toBeCloseTo(cursor.y);
  });

  it('uses inclusive document bounds for hit testing', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(pointInsideRect({ x: 10, y: 60 }, rect)).toBe(true);
    expect(pointInsideRect({ x: 41, y: 60 }, rect)).toBe(false);
  });

  it('fits a dragged viewport rectangle and centers its document point', () => {
    const viewport = { width: 800, height: 600 };
    const before = { scale: 1, panX: 0, panY: 0 };
    const after = zoomViewToViewportRect({
      rect: { x: 100, y: 100, width: 200, height: 150 },
      viewport,
      view: before,
      minScale: 0.01,
      maxScale: 100
    });
    expect(after.scale).toBe(4);
    const selectedDocumentCenter = { x: -200, y: -125 };
    expect(viewport.width / 2 + after.panX + selectedDocumentCenter.x * after.scale)
      .toBeCloseTo(viewport.width / 2);
    expect(viewport.height / 2 + after.panY + selectedDocumentCenter.y * after.scale)
      .toBeCloseTo(viewport.height / 2);
  });
});
