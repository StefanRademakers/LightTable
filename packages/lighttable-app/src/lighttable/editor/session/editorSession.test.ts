import { describe, expect, it } from 'vitest';
import {
  cloneVectorEditorSelection,
  createEditorSession,
  vectorEditorSelectionsEqual
} from './editorSession';
import type { LayerId } from '../document/documentTypes';

describe('LightTable editor session', () => {
  it('starts row and column selections at one document pixel', () => {
    const session = createEditorSession();
    expect(session.selectionRowHeight).toBe(1);
    expect(session.selectionColumnWidth).toBe(1);
  });

  it('starts the shared paint and erase brush at five percent spacing', () => {
    expect(createEditorSession().brush.spacing).toBe(0.05);
  });

  it('starts with document-local vector selection state', () => {
    expect(createEditorSession().vectorSelection).toEqual({
      elements: [],
      paths: [],
      anchors: [],
      active: null
    });
  });

  it('compares and clones scene-scoped vector selection without aliasing it', () => {
    const layerId = 'layer-1' as LayerId;
    const source = {
      elements: [{ layerId, elementId: 'path-1' }],
      paths: [{ layerId, pathId: 'path-1' }],
      anchors: [{
        layerId,
        pathId: 'path-1',
        subpathId: 'subpath-1',
        anchorId: 'anchor-1'
      }],
      active: {
        layerId,
        pathId: 'path-1',
        target: {
          kind: 'anchor' as const,
          subpathId: 'subpath-1',
          anchorId: 'anchor-1'
        }
      }
    };
    const clone = cloneVectorEditorSelection(source);

    expect(clone).not.toBe(source);
    expect(clone.elements[0]).not.toBe(source.elements[0]);
    expect(clone.paths[0]).not.toBe(source.paths[0]);
    expect(clone.active?.target).not.toBe(source.active.target);
    expect(vectorEditorSelectionsEqual(source, clone)).toBe(true);
    expect(vectorEditorSelectionsEqual(source, {
      ...clone,
      paths: [{ layerId, pathId: 'path-2' }]
    })).toBe(false);
  });

  it('keeps Warp settings document-scoped and source-pixel based', () => {
    expect(createEditorSession().warp).toMatchObject({
      mode: 'push',
      diameterPx: 500,
      strength: 1,
      hardness: 0.5,
      flow: 1,
      spacing: 0.04,
      pressureSize: true,
      pressureStrength: true,
      debugView: 'result'
    });
  });
});
