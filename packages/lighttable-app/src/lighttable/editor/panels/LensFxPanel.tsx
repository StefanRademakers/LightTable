import React, { useState } from 'react';
import { ActionButton } from '../../../ui/ActionButton';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { EffectPanel } from '../../effects/EffectPanel';
import {
  DEFAULT_CHROMATIC_ABERRATION_SETTINGS
} from '../../effects/chromaticAberration/settings';
import { DEFAULT_GRAIN_SETTINGS } from '../../effects/grain/settings';
import { DEFAULT_HALATION_SETTINGS } from '../../effects/halation/settings';
import {
  DEFAULT_LENS_BLUR_SETTINGS,
  focusInterval,
  type BokehShape,
  type LensBlurQuality
} from '../../effects/lensBlur/settings';
import {
  DEFAULT_LENS_DISTORTION_SETTINGS
} from '../../effects/lensDistortion/settings';
import type { LightTableImageMetadata } from '../../types';
import {
  type AdjustmentPresentationStore,
  useLensFxPresentation
} from '../../application/adjustments/adjustmentPresentationStore';
import type {
  DepthAnalysisProgress,
  DepthAnalysisResult
} from '../../analysis/depth/types';
import {
  BOKEH_SHAPE_OPTIONS,
  CHROMATIC_ABERRATION_SLIDERS,
  GRAIN_ADVANCED_SLIDERS,
  GRAIN_SLIDERS,
  HALATION_SLIDERS,
  LENS_BLUR_QUALITY_OPTIONS,
  LENS_BLUR_SLIDERS,
  LENS_BLUR_VIEWPORT_MODE_OPTIONS,
  LENS_DISTORTION_SLIDERS,
  type ChromaticAberrationNumericKey,
  type GrainNumericKey,
  type HalationNumericKey,
  type LensBlurNumericKey,
  type LensBlurViewportMode,
  type LensDistortionNumericKey
} from '../config/adjustmentControls';

export interface LensFxExpandedState {
  readonly grain: boolean;
  readonly halation: boolean;
  readonly chromaticAberration: boolean;
  readonly lensDistortion: boolean;
  readonly lensBlur: boolean;
}

export interface LensFxPanelModel {
  readonly adjustmentStore: AdjustmentPresentationStore;
  readonly metadata: LightTableImageMetadata | null;
  readonly resetModifierActive: boolean;
  readonly depthProgress: DepthAnalysisProgress;
  readonly depthResult: DepthAnalysisResult | null;
  readonly viewportMode: LensBlurViewportMode;
  readonly focusPickerActive: boolean;
}

export interface LensFxPanelCommands {
  readonly beginAdjustment: () => void;
  readonly endAdjustment: () => void;
  readonly grain: {
    setEnabled: () => void;
    update: (key: GrainNumericKey, value: number) => void;
    resetControl: (key: GrainNumericKey) => void;
    reset: () => void;
  };
  readonly halation: {
    setEnabled: (enabled: boolean) => void;
    update: (key: HalationNumericKey, value: number) => void;
    resetControl: (key: HalationNumericKey) => void;
    reset: () => void;
  };
  readonly chromaticAberration: {
    setEnabled: (enabled: boolean) => void;
    update: (key: ChromaticAberrationNumericKey, value: number) => void;
    resetControl: (key: ChromaticAberrationNumericKey) => void;
    reset: () => void;
  };
  readonly lensDistortion: {
    setEnabled: (enabled: boolean) => void;
    update: (key: LensDistortionNumericKey, value: number) => void;
    resetControl: (key: LensDistortionNumericKey) => void;
    reset: () => void;
  };
  readonly lensBlur: {
    setEnabled: (enabled: boolean) => void;
    update: (key: LensBlurNumericKey, value: number) => void;
    resetControl: (key: LensBlurNumericKey) => void;
    reset: () => void;
    setShape: (shape: BokehShape) => void;
    setQuality: (quality: LensBlurQuality) => void;
    setViewportMode: (mode: LensBlurViewportMode) => void;
    toggleFocusPicker: () => void;
  };
}

export interface LensFxPanelProps {
  readonly model: LensFxPanelModel;
  readonly commands: LensFxPanelCommands;
}

export const LensFxPanel = ({ model, commands }: LensFxPanelProps) => {
  const [grainAdvancedExpanded, setGrainAdvancedExpanded] = useState(false);
  const [expanded, setExpanded] = useState<LensFxExpandedState>({
    grain: true,
    halation: true,
    chromaticAberration: true,
    lensDistortion: true,
    lensBlur: true
  });
  const adjustments = useLensFxPresentation(model.adjustmentStore);
  const { metadata, resetModifierActive } = model;
  const setGroupExpanded = (
    group: keyof LensFxExpandedState,
    next: boolean
  ) => {
    setExpanded((current) => ({ ...current, [group]: next }));
  };

  const grain = adjustments.effects.grain;
  const halation = adjustments.effects.halation;
  const chromaticAberration = adjustments.effects.chromaticAberration;
  const lensDistortion = adjustments.effects.lensDistortion;
  const lensBlur = adjustments.effects.lensBlur;
  const analyzing = model.depthProgress.status === 'loading-model'
    || model.depthProgress.status === 'estimating';
  const focus = focusInterval(lensBlur);
  const focusVisualizationStyle = {
    '--focus-start': `${focus.start * 100}%`,
    '--focus-end': `${focus.end * 100}%`,
    '--focus-distance': `${lensBlur.focusDistance * 100}%`,
    '--transition-feather': `${Math.min(40, lensBlur.transitionFeather * 100)}%`,
    '--aperture-size': `${Math.max(14, lensBlur.apertureSize)}%`
  } as React.CSSProperties;

  return (
    <aside className="lighttable-panel">
      <div className="lighttable-panel__controls">
        <EffectPanel
          label="Lens Distortion"
          expanded={expanded.lensDistortion}
          enabled={lensDistortion.enabled}
          resetModifierActive={resetModifierActive}
          onExpandedChange={(next) => setGroupExpanded('lensDistortion', next)}
          onEnabledChange={commands.lensDistortion.setEnabled}
          onReset={commands.lensDistortion.reset}
        >
          {LENS_DISTORTION_SLIDERS.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={lensDistortion[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_LENS_DISTORTION_SETTINGS[slider.key]}
              disabled={!metadata || !lensDistortion.enabled}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.lensDistortion.update(slider.key, value)}
              onReset={() => commands.lensDistortion.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
        </EffectPanel>

        <EffectPanel
          label="Chromatic Aberration"
          expanded={expanded.chromaticAberration}
          enabled={chromaticAberration.enabled}
          resetModifierActive={resetModifierActive}
          onExpandedChange={(next) => setGroupExpanded('chromaticAberration', next)}
          onEnabledChange={commands.chromaticAberration.setEnabled}
          onReset={commands.chromaticAberration.reset}
        >
          {CHROMATIC_ABERRATION_SLIDERS.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={chromaticAberration[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_CHROMATIC_ABERRATION_SETTINGS[slider.key]}
              disabled={!metadata || !chromaticAberration.enabled}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.chromaticAberration.update(slider.key, value)}
              onReset={() => commands.chromaticAberration.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
        </EffectPanel>

        <EffectPanel
          label="Lens Blur"
          expanded={expanded.lensBlur}
          enabled={lensBlur.enabled}
          resetModifierActive={resetModifierActive}
          onExpandedChange={(next) => setGroupExpanded('lensBlur', next)}
          onEnabledChange={commands.lensBlur.setEnabled}
          onReset={commands.lensBlur.reset}
        >
          {model.depthProgress.status !== 'idle' ? (
            <div className={`lighttable-lens-blur__status lighttable-lens-blur__status--${model.depthProgress.status}`}>
              <span>{model.depthProgress.message ?? (analyzing ? 'Analyzing depth…' : 'Depth ready')}</span>
              {typeof model.depthProgress.progress === 'number'
                ? <span>{Math.round(model.depthProgress.progress)}%</span>
                : null}
            </div>
          ) : null}
          <div className="lighttable-lens-blur__select-controls">
            <label className="lighttable-lens-blur__select-row">
              <span>Render quality</span>
              <select
                aria-label="Lens Blur render quality"
                value={lensBlur.quality}
                disabled={!lensBlur.enabled || analyzing}
                onChange={(event) => commands.lensBlur.setQuality(event.currentTarget.value as LensBlurQuality)}
              >
                {LENS_BLUR_QUALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="lighttable-lens-blur__select-row">
              <span>Bokeh shape</span>
              <select
                aria-label="Lens Blur bokeh shape"
                value={lensBlur.bokehShape}
                disabled={!lensBlur.enabled || analyzing}
                onChange={(event) => commands.lensBlur.setShape(event.currentTarget.value as BokehShape)}
              >
                {BOKEH_SHAPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="lighttable-lens-blur__visualization"
            style={focusVisualizationStyle}
            aria-hidden="true"
          >
            <span className="lighttable-lens-blur__visualization-taper lighttable-lens-blur__visualization-taper--low" />
            <span className="lighttable-lens-blur__visualization-taper lighttable-lens-blur__visualization-taper--high" />
            <span className="lighttable-lens-blur__visualization-focus-zone" />
            <span className="lighttable-lens-blur__visualization-focus-marker" />
            <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--low" />
            <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--focus" />
            <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--high" />
          </div>
          <SegmentedControl
            options={LENS_BLUR_VIEWPORT_MODE_OPTIONS.map((option) => ({
              ...option,
              disabled: !lensBlur.enabled
                || (option.value === 'depth' && (!model.depthResult || analyzing))
            }))}
            value={model.viewportMode}
            onChange={commands.lensBlur.setViewportMode}
            ariaLabel="Lens Blur viewport mode"
            className="lighttable-lens-blur__viewport-modes"
          />
          <div className="lighttable-lens-blur__actions">
            <ActionButton
              className={model.focusPickerActive ? 'action-button--active' : ''}
              onClick={commands.lensBlur.toggleFocusPicker}
              disabled={!lensBlur.enabled || !model.depthResult || analyzing}
            >
              Pick focus
            </ActionButton>
          </div>
          {LENS_BLUR_SLIDERS.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={lensBlur[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_LENS_BLUR_SETTINGS[slider.key]}
              disabled={!metadata || !lensBlur.enabled || analyzing}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.lensBlur.update(slider.key, value)}
              onReset={() => commands.lensBlur.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
        </EffectPanel>

        <EffectPanel
          label="Halation"
          expanded={expanded.halation}
          enabled={halation.enabled}
          resetModifierActive={resetModifierActive}
          onExpandedChange={(next) => setGroupExpanded('halation', next)}
          onEnabledChange={commands.halation.setEnabled}
          onReset={commands.halation.reset}
        >
          {HALATION_SLIDERS.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={halation[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_HALATION_SETTINGS[slider.key]}
              disabled={!metadata || !halation.enabled}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.halation.update(slider.key, value)}
              onReset={() => commands.halation.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
        </EffectPanel>

        <EffectPanel
          label="Grain"
          expanded={expanded.grain}
          enabled={grain.enabled}
          resetModifierActive={resetModifierActive}
          onExpandedChange={(next) => setGroupExpanded('grain', next)}
          onEnabledChange={commands.grain.setEnabled}
          onReset={commands.grain.reset}
        >
          {GRAIN_SLIDERS.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={grain[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_GRAIN_SETTINGS[slider.key]}
              disabled={!metadata || !grain.enabled}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.grain.update(slider.key, value)}
              onReset={() => commands.grain.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
          <div className="lighttable-subgroup">
            <button
              type="button"
              className="lighttable-subgroup__toggle"
              onClick={() => setGrainAdvancedExpanded((current) => !current)}
              aria-expanded={grainAdvancedExpanded}
            >
              <img
                src={lightTableIcon(grainAdvancedExpanded ? 'area_open.png' : 'area_closed.png')}
                alt=""
                aria-hidden="true"
              />
              <strong>Advanced</strong>
            </button>
            {grainAdvancedExpanded ? (
              <div className="lighttable-subgroup__controls">
                {GRAIN_ADVANCED_SLIDERS.map((slider) => (
                  <AdjustmentSlider
                    key={slider.key}
                    label={slider.label}
                    value={grain[slider.key]}
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    format={slider.format}
                    track={slider.track}
                    resetValue={DEFAULT_GRAIN_SETTINGS[slider.key]}
                    disabled={!metadata || !grain.enabled}
                    resetModifierActive={resetModifierActive}
                    onChange={(value) => commands.grain.update(slider.key, value)}
                    onReset={() => commands.grain.resetControl(slider.key)}
                    onInteractionStart={commands.beginAdjustment}
                    onInteractionEnd={commands.endAdjustment}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </EffectPanel>
      </div>
    </aside>
  );
};
