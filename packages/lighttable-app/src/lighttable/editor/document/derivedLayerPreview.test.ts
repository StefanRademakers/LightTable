import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import {
  createTextLayerNode,
  layerDerivedPreviewIsCurrent,
  semanticLayerDependencyKey
} from './documentTypes';

describe('derived semantic layer previews', () => {
  it('stays current across presentation-only layer changes and expires on text edits', () => {
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Imported text');
    text.derivedPreview = {
      width: 120,
      height: 32,
      transform: text.transform,
      dependencyKey: semanticLayerDependencyKey(text)!,
      source: 'photoshop-layer-preview'
    };

    expect(layerDerivedPreviewIsCurrent(text)).toBe(true);
    expect(layerDerivedPreviewIsCurrent({ ...text, opacity: 0.5, revision: 12 })).toBe(true);
    expect(layerDerivedPreviewIsCurrent({
      ...text,
      text: {
        ...text.text,
        revisions: { ...text.text.revisions, content: text.text.revisions.content + 1 }
      }
    })).toBe(false);
  });
});
