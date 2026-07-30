import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_SETTINGS,
  DEFAULT_SCOPE_VISIBILITY
} from '../../scopes';
import { createScopeRendererOptions } from './useRendererPresentationSync';

describe('createScopeRendererOptions', () => {
  it('keeps shared hue analysis alive and projects visible scopes exactly', () => {
    const options = createScopeRendererOptions(
      {
        ...DEFAULT_SCOPE_VISIBILITY,
        parade: false,
        vectorscope: true
      },
      {
        ...DEFAULT_SCOPE_SETTINGS,
        traceBrightness: 0.42,
        vectorscopeZoom2x: true
      }
    );

    expect(options).toMatchObject({
      hueDistributionVisible: true,
      paradeVisible: false,
      vectorscopeVisible: true,
      traceBrightness: 0.42,
      vectorscopeZoom2x: true
    });
  });
});
