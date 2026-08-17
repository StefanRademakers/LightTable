import { ButtonBase } from '../../../ui/ButtonBase';
import React, { useEffect, useRef, useState } from 'react';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { SwitchControl } from '../../../ui/SwitchControl';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { SquareIconButton } from '../../../ui/SquareIconButton';
import { ColorGradingWheel } from '../../ColorGradingWheel';
import {
  COLOR_GRADING_ZONE_LABELS,
  colorGradingZoneIndex,
  type ColorGradingMode,
  type ColorGradingZone
} from '../../colorGrading';
import {
  COLOR_MIXER_CHANNELS,
  COLOR_MIXER_RANGES,
  colorMixerTrack,
  type ColorMixerChannel
} from '../../colorMixer';
import {
  MAX_POINT_COLOR_SAMPLES,
  pointColorSampleCss,
  type PointColorSample
} from '../../pointColor';
import { CurvesEditor } from '../../CurvesEditor';
import type { CurveChannel, ToneCurve } from '../../curves';
import {
  type GroupVisibility,
  type NumericAdjustmentKey
} from '../../application/adjustments/groupVisibility';
import {
  type AdjustmentPresentationStore,
  useGradePresentation
} from '../../application/adjustments/adjustmentPresentationStore';
import {
  COLOR_SLIDERS,
  colorMixerRangeBounds,
  EFFECTS_SLIDERS,
  GRADING_MODE_OPTIONS,
  LIGHT_SLIDERS,
  MIXER_CHANNEL_LABELS,
  nearestColorMixerRange,
  type SliderDefinition
} from '../config/adjustmentControls';
import {
  DEFAULT_BASIC_ADJUSTMENTS,
  type LightTableImageMetadata,
  type GradientMapAdjustments,
  type RgbHistogram
} from '../../types';
import type { PhotoshopAdjustmentSettings } from '../../photoshopAdjustments';

type GradeGroup = Exclude<keyof GroupVisibility, 'globalGrade' | 'globalLensFx'>;

export interface GradePanelModel {
  readonly adjustmentStore: AdjustmentPresentationStore;
  readonly metadata: LightTableImageMetadata | null;
  readonly visibility: GroupVisibility;
  readonly histogram: RgbHistogram | null;
  readonly resetModifierActive: boolean;
  readonly masterEnabled: boolean;
  readonly colorMixerScopeContainerRef: React.RefObject<HTMLDivElement | null>;
  readonly colorMixerHueCanvasRef: React.RefCallback<HTMLCanvasElement>;
  readonly colorLookupAssets?: readonly { readonly id: string; readonly name: string }[];
  readonly pointColorPickerActive: boolean;
}

export interface GradePanelCommands {
  readonly resetAll: () => void;
  readonly toggleMasterEnabled: () => void;
  readonly toggleVisibility: (group: keyof GroupVisibility) => void;
  readonly resetGroup: (group: GradeGroup) => void;
  readonly beginAdjustment: () => void;
  readonly endAdjustment: () => void;
  readonly updateAdjustment: (key: NumericAdjustmentKey, value: number) => void;
  readonly resetAdjustment: (key: NumericAdjustmentKey) => void;
  readonly updateColorMixer: (
    channel: ColorMixerChannel,
    index: number,
    value: number
  ) => void;
  readonly resetColorMixer: (channel: ColorMixerChannel, index: number) => void;
  readonly addPointColorSample: (
    id: string, lightness: number, chroma: number, hue: number
  ) => void;
  readonly updatePointColorSample: (
    id: string,
    key: Exclude<keyof PointColorSample, 'id' | 'lightness' | 'chroma' | 'hue'>,
    value: number
  ) => void;
  readonly resetPointColorSample: (id: string) => void;
  readonly removePointColorSample: (id: string) => void;
  readonly togglePointColorPicker: () => void;
  readonly updateColorGradingWheel: (
    zone: ColorGradingZone,
    hue: number,
    saturation: number
  ) => void;
  readonly updateColorGradingLuminance: (
    zone: ColorGradingZone,
    value: number
  ) => void;
  readonly updateColorGradingControl: (
    control: 'blending' | 'balance',
    value: number
  ) => void;
  readonly resetColorGradingControl: (
    control: 'blending' | 'balance'
  ) => void;
  readonly resetColorGradingZone: (zone: ColorGradingZone) => void;
  readonly resetColorGradingLuminance: (zone: ColorGradingZone) => void;
  readonly updateCurve: (channel: CurveChannel, points: ToneCurve) => void;
  readonly resetCurve: (channel: CurveChannel) => void;
  readonly updateGradientMap: (value: GradientMapAdjustments) => void;
  readonly resetGradientMap: () => void;
  readonly updatePhotoshopAdjustment: (value: PhotoshopAdjustmentSettings) => void;
  readonly resetPhotoshopAdjustment: () => void;
  readonly loadColorLookup?: (file: File) => Promise<void>;
}

export interface GradePanelProps {
  readonly model: GradePanelModel;
  readonly commands: GradePanelCommands;
  readonly gradeTitle?: 'Global Grade' | 'Grade Layer' | 'Local Grade';
}

const DEFAULT_EXPANDED: Readonly<Record<GradeGroup, boolean>> = {
  light: true,
  color: true,
  effects: true,
  colorMixer: true,
  colorGrading: true,
  curves: true
};

interface GroupHeaderProps {
  readonly label: string;
  readonly expanded: boolean;
  readonly visible: boolean;
  readonly resetModifierActive: boolean;
  readonly setExpanded: (expanded: boolean) => void;
  readonly reset: () => void;
  readonly toggleVisibility: () => void;
}

const GroupHeader = ({
  label,
  expanded,
  visible,
  resetModifierActive,
  setExpanded,
  reset,
  toggleVisibility
}: GroupHeaderProps) => (
  <div className="lighttable-group__header">
    <ButtonBase
      type="button"
      className="lighttable-group__toggle"
      onPointerDown={(event) => {
        if (event.button === 0 && (event.shiftKey || resetModifierActive)) {
          event.preventDefault();
          reset();
        }
      }}
      onClick={(event) => {
        if (event.shiftKey || resetModifierActive) {
          event.preventDefault();
          reset();
          return;
        }
        setExpanded(!expanded);
      }}
      aria-expanded={expanded}
      title={resetModifierActive ? `Reset ${label}` : label}
    >
      <img
        src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')}
        alt=""
        aria-hidden="true"
      />
      <strong>{label}</strong>
    </ButtonBase>
    <div className="lighttable-group__actions">
      <ButtonBase
        type="button"
        className="lighttable-group__reset"
        onClick={reset}
        aria-label={`Reset ${label} adjustments`}
        title={`Reset ${label} adjustments`}
      >
        <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
      </ButtonBase>
      <SwitchControl
        checked={visible}
        onCheckedChange={toggleVisibility}
        label={`${visible ? 'Disable' : 'Enable'} ${label} adjustments`}
      />
    </div>
  </div>
);

export const GradePanel = ({ model, commands, gradeTitle = 'Local Grade' }: GradePanelProps) => {
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);
  const [selectedColorMixerRange, setSelectedColorMixerRange] = useState(0);
  const [colorMixerView, setColorMixerView] = useState<'mixer' | 'point'>('mixer');
  const [selectedPointColorId, setSelectedPointColorId] = useState<string | null>(null);
  const pointColorSampleCountRef = useRef(0);
  const [colorGradingMode, setColorGradingMode] = useState<ColorGradingMode>('all');
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('master');
  const adjustments = useGradePresentation(model.adjustmentStore);
  const { metadata, visibility, resetModifierActive } = model;

  useEffect(() => {
    const samples = adjustments.pointColor.samples;
    const sampleWasAdded = samples.length > pointColorSampleCountRef.current;
    pointColorSampleCountRef.current = samples.length;
    if (samples.length === 0) {
      setSelectedPointColorId(null);
      return;
    }
    if (sampleWasAdded || !samples.some((sample) => sample.id === selectedPointColorId)) {
      setSelectedPointColorId(samples[samples.length - 1]!.id);
    }
  }, [adjustments.pointColor.samples, selectedPointColorId]);

  const setGroupExpanded = (group: GradeGroup, next: boolean) => {
    setExpanded((current) => ({ ...current, [group]: next }));
  };

  const renderAdjustmentGroup = (
    group: 'light' | 'color' | 'effects',
    label: string,
    sliders: readonly SliderDefinition[]
  ) => (
    <section className={`lighttable-group${visibility[group] ? '' : ' lighttable-group--disabled'}`}>
      <GroupHeader
        label={label}
        expanded={expanded[group]}
        visible={visibility[group]}
        resetModifierActive={resetModifierActive}
        setExpanded={(next) => setGroupExpanded(group, next)}
        reset={() => commands.resetGroup(group)}
        toggleVisibility={() => commands.toggleVisibility(group)}
      />
      {expanded[group] ? (
        <div className="lighttable-group__controls">
          {sliders.map((slider) => (
            <AdjustmentSlider
              key={slider.key}
              label={slider.label}
              value={adjustments[slider.key]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              format={slider.format}
              track={slider.track}
              resetValue={DEFAULT_BASIC_ADJUSTMENTS[slider.key]}
              disabled={!metadata || !visibility[group]}
              resetModifierActive={resetModifierActive}
              onChange={(value) => commands.updateAdjustment(slider.key, value)}
              onReset={() => commands.resetAdjustment(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
        </div>
      ) : null}
    </section>
  );

  const renderPointColor = () => {
    const selected = adjustments.pointColor.samples.find(
      (sample) => sample.id === selectedPointColorId
    ) ?? null;
    const disabled = !metadata || !visibility.colorMixer || !selected;
    const update = (
      key: Exclude<keyof PointColorSample, 'id' | 'lightness' | 'chroma' | 'hue'>,
      value: number
    ) => {
      if (selected) commands.updatePointColorSample(selected.id, key, value);
    };
    const swatch = selected ? pointColorSampleCss(selected) : '#7c828a';
    const controls = [
      { key: 'hueShift', label: 'Hue Shift', min: -100, max: 100, reset: 0,
        track: 'linear-gradient(to right, #e95b63, #e6c64e, #52be76, #4fc2c5, #5c78dc, #bd55bd, #e95b63)' },
      { key: 'saturationShift', label: 'Saturation Shift', min: -100, max: 100, reset: 0,
        track: `linear-gradient(to right, #5b6067, ${swatch})` },
      { key: 'luminanceShift', label: 'Luminance Shift', min: -100, max: 100, reset: 0,
        track: `linear-gradient(to right, #383c42, ${swatch}, #f1f3f5)` },
      { key: 'variance', label: 'Variance', min: -100, max: 100, reset: 0 },
      { key: 'range', label: 'Range', min: 0, max: 100, reset: 50 },
      { key: 'hueRange', label: 'Hue Range', min: 0, max: 100, reset: 50,
        track: 'linear-gradient(to right, #5b6067, #df5b62, #d2c94b, #4db66c, #4bc2c3, #5575dc, #cf4eaa)' },
      { key: 'saturationRange', label: 'Saturation Range', min: 0, max: 100, reset: 50,
        track: `linear-gradient(to right, #5b6067, ${swatch})` },
      { key: 'luminanceRange', label: 'Luminance Range', min: 0, max: 100, reset: 50,
        track: 'linear-gradient(to right, #383c42, #f1f3f5)' }
    ] as const;

    return (
      <div className="lighttable-point-color">
        <div className="lighttable-point-color__samples">
          <SquareIconButton
            size="compact"
            active={model.pointColorPickerActive}
            disabled={!metadata || adjustments.pointColor.samples.length >= MAX_POINT_COLOR_SAMPLES}
            aria-label="Sample Point Color from image"
            title="Sample Point Color from image"
            onClick={commands.togglePointColorPicker}
            icon={<img src={lightTableIcon('tool_sample_color.png')} alt="" aria-hidden="true" />}
          />
          {adjustments.pointColor.samples.map((sample) => (
            <SquareIconButton
              key={sample.id}
              size="compact"
              active={sample.id === selectedPointColorId}
              aria-label="Select sampled color"
              title="Select sampled color"
              onClick={() => setSelectedPointColorId(sample.id)}
              icon={<span className="lighttable-point-color__swatch" style={{ background: pointColorSampleCss(sample) }} />}
            />
          ))}
          <SquareIconButton
            size="compact"
            appearance="quiet"
            disabled={!selected}
            aria-label="Reset sampled color adjustments"
            title="Reset sampled color adjustments"
            onClick={() => selected && commands.resetPointColorSample(selected.id)}
            icon={<img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />}
          />
          <SquareIconButton
            size="compact"
            appearance="quiet"
            disabled={!selected}
            aria-label="Remove sampled color"
            title="Remove sampled color"
            onClick={() => selected && commands.removePointColorSample(selected.id)}
            icon={<img src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" />}
          />
        </div>
        {controls.map((control) => (
          <AdjustmentSlider
            density="spaced"
            key={control.key}
            label={control.label}
            value={selected?.[control.key] ?? control.reset}
            min={control.min}
            max={control.max}
            resetValue={control.reset}
            trackBackground={'track' in control ? control.track : undefined}
            disabled={disabled}
            resetModifierActive={resetModifierActive}
            onChange={(value) => update(control.key, value)}
            onReset={() => update(control.key, control.reset)}
            onInteractionStart={commands.beginAdjustment}
            onInteractionEnd={commands.endAdjustment}
          />
        ))}
      </div>
    );
  };

  const renderColorMixer = () => {
    const group = 'colorMixer' as const;
    const visible = visibility[group];
    const selectedRange = COLOR_MIXER_RANGES[selectedColorMixerRange];
    const rangeBounds = colorMixerRangeBounds(selectedColorMixerRange);
    const rangeSpans = rangeBounds.start <= rangeBounds.end
      ? [{ left: rangeBounds.start, width: rangeBounds.end - rangeBounds.start }]
      : [
          { left: rangeBounds.start, width: 1 - rangeBounds.start },
          { left: 0, width: rangeBounds.end }
        ];
    const selectRangeAtPointer = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!metadata || !visible) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width < 1) return;
      const position = Math.max(
        0,
        Math.min(0.999999, (event.clientX - bounds.left) / bounds.width)
      );
      setSelectedColorMixerRange(nearestColorMixerRange(position));
    };

    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <GroupHeader
          label="Color Mixer"
          expanded={expanded[group]}
          visible={visible}
          resetModifierActive={resetModifierActive}
          setExpanded={(next) => setGroupExpanded(group, next)}
          reset={() => commands.resetGroup(group)}
          toggleVisibility={() => commands.toggleVisibility(group)}
        />
        <div
          className="lighttable-group__controls lighttable-color-mixer"
          hidden={!expanded[group]}
        >
          <SegmentedControl
            value={colorMixerView}
            onChange={(next) => {
              setColorMixerView(next);
              if (next !== 'point' && model.pointColorPickerActive) {
                commands.togglePointColorPicker();
              }
            }}
            ariaLabel="Color Mixer editor"
            options={[
              { value: 'mixer', label: 'Mixer' },
              { value: 'point', label: 'Point Color' }
            ]}
          />
          {colorMixerView === 'mixer' ? <>
          <div
            ref={model.colorMixerScopeContainerRef}
            className="lighttable-color-mixer__picker"
            role="slider"
            aria-label="Color Mixer hue range"
            aria-valuemin={0}
            aria-valuemax={COLOR_MIXER_RANGES.length - 1}
            aria-valuenow={selectedColorMixerRange}
            aria-valuetext={selectedRange.label}
            aria-disabled={!metadata || !visible}
            tabIndex={metadata && visible ? 0 : -1}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              selectRangeAtPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                selectRangeAtPointer(event);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'ArrowLeft'
                && event.key !== 'ArrowRight'
                && event.key !== 'Home'
                && event.key !== 'End'
              ) return;
              event.preventDefault();
              if (event.key === 'Home') setSelectedColorMixerRange(0);
              else if (event.key === 'End') {
                setSelectedColorMixerRange(COLOR_MIXER_RANGES.length - 1);
              } else {
                const direction = event.key === 'ArrowLeft' ? -1 : 1;
                setSelectedColorMixerRange((current) => (
                  current + direction + COLOR_MIXER_RANGES.length
                ) % COLOR_MIXER_RANGES.length);
              }
            }}
          >
            <canvas
              ref={model.colorMixerHueCanvasRef}
              className="lighttable-color-mixer__scope"
              aria-hidden="true"
            />
            <div className="lighttable-color-mixer__hue-strip" aria-hidden="true" />
            <div className="lighttable-color-mixer__range-overlay" aria-hidden="true">
              {rangeSpans.map((span, index) => (
                <span
                  className="lighttable-color-mixer__range-fill"
                  key={`${span.left}-${index}`}
                  style={{
                    left: `${span.left * 100}%`,
                    width: `${span.width * 100}%`
                  }}
                />
              ))}
              <span
                className="lighttable-color-mixer__range-marker"
                style={{ left: `${rangeBounds.start * 100}%` }}
              />
              <span
                className="lighttable-color-mixer__range-marker"
                style={{ left: `${rangeBounds.end * 100}%` }}
              />
            </div>
          </div>
          <div className="lighttable-color-mixer__selection">
            <span
              className="lighttable-color-mixer__selection-swatch"
              style={{ background: selectedRange.color }}
            />
            <strong>{selectedRange.label}</strong>
          </div>
          {COLOR_MIXER_CHANNELS.map((channel) => (
            <AdjustmentSlider
              density="spaced"
              key={`${channel}-${selectedRange.label}`}
              label={MIXER_CHANNEL_LABELS[channel]}
              value={adjustments.colorMixer[channel][selectedColorMixerRange]}
              min={-100}
              max={100}
              resetValue={0}
              trackBackground={colorMixerTrack(channel, selectedColorMixerRange)}
              disabled={!metadata || !visible}
              resetModifierActive={resetModifierActive}
              onChange={(value) => {
                commands.updateColorMixer(channel, selectedColorMixerRange, value);
              }}
              onReset={() => commands.resetColorMixer(channel, selectedColorMixerRange)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          ))}
          </> : renderPointColor()}
        </div>
      </section>
    );
  };

  const renderColorGradingWheel = (zone: ColorGradingZone, compact = false) => {
    const index = colorGradingZoneIndex(zone);
    const visible = visibility.colorGrading;
    return (
      <div className="lighttable-color-grading__wheel-block" key={zone}>
        <ColorGradingWheel
          label={COLOR_GRADING_ZONE_LABELS[zone]}
          hue={adjustments.colorGrading.hue[index]}
          saturation={adjustments.colorGrading.saturation[index]}
          luminance={adjustments.colorGrading.luminance[index]}
          compact={compact}
          disabled={!metadata || !visible}
          resetModifierActive={resetModifierActive}
          onChange={(hue, saturation) => {
            commands.updateColorGradingWheel(zone, hue, saturation);
          }}
          onReset={() => commands.resetColorGradingZone(zone)}
          onInteractionStart={commands.beginAdjustment}
          onInteractionEnd={commands.endAdjustment}
        />
        <AdjustmentSlider
          density={compact ? 'compact' : 'default'}
          label="Luminance"
          value={adjustments.colorGrading.luminance[index]}
          min={-100}
          max={100}
          track="luminance"
          resetValue={0}
          disabled={!metadata || !visible}
          resetModifierActive={resetModifierActive}
          onChange={(value) => commands.updateColorGradingLuminance(zone, value)}
          onReset={() => commands.resetColorGradingLuminance(zone)}
          onInteractionStart={commands.beginAdjustment}
          onInteractionEnd={commands.endAdjustment}
        />
      </div>
    );
  };

  const renderColorGrading = () => {
    const group = 'colorGrading' as const;
    const visible = visibility[group];
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <GroupHeader
          label="Color Grading"
          expanded={expanded[group]}
          visible={visible}
          resetModifierActive={resetModifierActive}
          setExpanded={(next) => setGroupExpanded(group, next)}
          reset={() => commands.resetGroup(group)}
          toggleVisibility={() => commands.toggleVisibility(group)}
        />
        {expanded[group] ? (
          <div className="lighttable-group__controls lighttable-color-grading">
            <SegmentedControl
              options={GRADING_MODE_OPTIONS}
              value={colorGradingMode}
              onChange={setColorGradingMode}
              ariaLabel="Color Grading tonal range"
              className="lighttable-color-grading__modes"
            />
            {colorGradingMode === 'all' ? (
              <div className="lighttable-color-grading__three-way">
                {renderColorGradingWheel('midtones')}
                <div className="lighttable-color-grading__split">
                  {renderColorGradingWheel('shadows', true)}
                  {renderColorGradingWheel('highlights', true)}
                </div>
              </div>
            ) : renderColorGradingWheel(colorGradingMode)}
            <div className="lighttable-color-grading__range-controls">
              <AdjustmentSlider
                label="Blending"
                value={adjustments.colorGrading.blending}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={50}
                disabled={!metadata || !visible}
                resetModifierActive={resetModifierActive}
                onChange={(value) => commands.updateColorGradingControl('blending', value)}
                onReset={() => commands.resetColorGradingControl('blending')}
                onInteractionStart={commands.beginAdjustment}
                onInteractionEnd={commands.endAdjustment}
              />
              <AdjustmentSlider
                label="Balance"
                value={adjustments.colorGrading.balance}
                min={-100}
                max={100}
                resetValue={0}
                disabled={!metadata || !visible}
                resetModifierActive={resetModifierActive}
                onChange={(value) => commands.updateColorGradingControl('balance', value)}
                onReset={() => commands.resetColorGradingControl('balance')}
                onInteractionStart={commands.beginAdjustment}
                onInteractionEnd={commands.endAdjustment}
              />
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  const renderCurves = () => {
    const group = 'curves' as const;
    const visible = visibility[group];
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <GroupHeader
          label="Custom Curves"
          expanded={expanded[group]}
          visible={visible}
          resetModifierActive={resetModifierActive}
          setExpanded={(next) => setGroupExpanded(group, next)}
          reset={() => commands.resetGroup(group)}
          toggleVisibility={() => commands.toggleVisibility(group)}
        />
        {expanded[group] ? (
          <div className="lighttable-group__controls">
            <CurvesEditor
              curves={adjustments.curves}
              channel={curveChannel}
              histogram={model.histogram}
              disabled={!metadata || !visible}
              onChannelChange={setCurveChannel}
              onChange={commands.updateCurve}
              onReset={commands.resetCurve}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label={`${gradeTitle} properties`}>
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label">
            <strong>{gradeTitle}</strong>
          </div>
          <div className="lighttable-group__actions">
            <ButtonBase
              type="button"
              className="lighttable-group__reset"
              onClick={commands.resetAll}
              aria-label="Reset all corrections"
              title="Reset all corrections"
            >
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </ButtonBase>
            <SwitchControl
              checked={model.masterEnabled}
              onCheckedChange={commands.toggleMasterEnabled}
              label={model.masterEnabled ? `Disable ${gradeTitle}` : `Enable ${gradeTitle}`}
            />
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        {renderAdjustmentGroup('light', 'Light', LIGHT_SLIDERS)}
        {renderAdjustmentGroup('color', 'Color', COLOR_SLIDERS)}
        {renderAdjustmentGroup('effects', 'Effects', EFFECTS_SLIDERS)}
        {renderColorMixer()}
        {renderColorGrading()}
        {renderCurves()}
      </div>
    </aside>
  );
};
