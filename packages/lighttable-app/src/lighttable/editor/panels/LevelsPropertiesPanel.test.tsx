import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../../application/adjustments/groupVisibility';
import { AdjustmentPresentationStore } from '../../application/adjustments/adjustmentPresentationStore';
import { createDefaultPhotoshopAdjustment } from '../../photoshopAdjustments';
import { createDefaultAdjustments } from '../../types';
import {
  levelsGammaFromPosition,
  levelsGammaPosition,
  LevelsPropertiesPanel
} from './LevelsPropertiesPanel';

const commands = () => {
  const noop = vi.fn();
  return {
    resetAll: noop, toggleOriginal: noop, toggleVisibility: noop, resetGroup: noop,
    beginAdjustment: noop, endAdjustment: noop, updateAdjustment: noop,
    resetAdjustment: noop, updateColorMixer: noop, resetColorMixer: noop,
    updateColorGradingWheel: noop, updateColorGradingLuminance: noop,
    updateColorGradingControl: noop, resetColorGradingControl: noop,
    resetColorGradingZone: noop, resetColorGradingLuminance: noop,
    updateCurve: noop, resetCurve: noop, updateGradientMap: noop, resetGradientMap: noop,
    updatePhotoshopAdjustment: noop, resetPhotoshopAdjustment: noop
  };
};

describe('LevelsPropertiesPanel', () => {
  it('combines the shared histogram, channel selector and Levels ranges', () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(<LevelsPropertiesPanel
      settings={createDefaultPhotoshopAdjustment('levels')}
      model={{
        adjustmentStore: new AdjustmentPresentationStore(createDefaultAdjustments()),
        metadata: null,
        visibility: createDefaultGroupVisibility(),
        histogram: null,
        resetModifierActive: false,
        showOriginal: false,
        colorMixerScopeContainerRef: { current: null },
        colorMixerHueCanvasRef: noop
      }}
      commands={commands()}
    />);

    expect(markup).toContain('aria-label="Levels properties"');
    expect(markup).toContain('aria-label="RGB histogram"');
    expect(markup).toContain('Input Levels');
    expect(markup).toContain('Output Levels');
    expect(markup.match(/type="range"/g)).toHaveLength(5);
    expect(markup).not.toContain('Black input</span>');
  });

  it('maps the gamma value to the middle handle and back without drift', () => {
    const levels = [20, 1.7, 230] as const;
    const position = levelsGammaPosition(levels);

    expect(levelsGammaFromPosition(position, levels[0], levels[2])).toBeCloseTo(levels[1], 8);
    expect(levelsGammaPosition([0, 1, 255])).toBe(127.5);
  });
});
