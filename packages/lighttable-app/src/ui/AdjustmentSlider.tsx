import React from 'react';
import { Slider, SliderField, sliderValueAtPosition, type SliderProps } from '@lighttable/ui';

export type AdjustmentSliderTrack =
  | 'luminance'
  | 'temperature'
  | 'tint'
  | 'vibrance'
  | 'saturation'
  | 'hue'
  | 'cyan-red'
  | 'magenta-green'
  | 'yellow-blue'
  | 'red-cyan'
  | 'green-magenta'
  | 'blue-yellow'
  | 'white-black';

const TRACK_BACKGROUNDS: Record<AdjustmentSliderTrack, string> = {
  luminance: 'linear-gradient(to right, #545960 0%, #f2f4f6 100%)',
  temperature: 'linear-gradient(to right, #4456d9 0%, #57a7d6 28%, #a6a8a3 52%, #d7c75b 76%, #f1ea35 100%)',
  tint: 'linear-gradient(to right, #38a35a 0%, #7ca777 30%, #9c969b 52%, #b45a9d 76%, #d638aa 100%)',
  vibrance: 'linear-gradient(to right, #536a91 0%, #4e9684 28%, #a1a471 55%, #d5a249 77%, #d54d54 100%)',
  saturation: 'linear-gradient(to right, #626870 0%, #4d79b8 20%, #4da882 42%, #d1b34e 70%, #d84b50 100%)',
  hue: 'linear-gradient(to right, #f33 0%, #ff0 16.67%, #0f6 33.33%, #0df 50%, #35f 66.67%, #f3c 83.33%, #f33 100%)',
  'cyan-red': 'linear-gradient(to right, #25aeb9 0%, #777c82 50%, #d94f56 100%)',
  'magenta-green': 'linear-gradient(to right, #c84ba5 0%, #777c82 50%, #48a45e 100%)',
  'yellow-blue': 'linear-gradient(to right, #d8bd42 0%, #777c82 50%, #4c6fd1 100%)',
  'red-cyan': 'linear-gradient(to right, #d94f56 0%, #777c82 50%, #25aeb9 100%)',
  'green-magenta': 'linear-gradient(to right, #48a45e 0%, #777c82 50%, #c84ba5 100%)',
  'blue-yellow': 'linear-gradient(to right, #4c6fd1 0%, #777c82 50%, #d8bd42 100%)',
  'white-black': 'linear-gradient(to right, #f2f4f6 0%, #777c82 50%, #1b1d20 100%)'
};

/** App-only labels, units, track presets and placement; interaction and skin live in the package. */
export interface AdjustmentSliderProps extends Omit<SliderProps, 'onReset'> {
  track?: AdjustmentSliderTrack;
  layout?: 'stacked' | 'inline' | 'bare' | 'layer-row' | 'tool-bar' | 'tool-panel';
  density?: 'default' | 'spaced' | 'compact';
  interactionMode?: 'managed' | 'native';
  onReset: () => void;
}
export const adjustmentSliderValueAtPosition = sliderValueAtPosition;
export const AdjustmentSlider = ({
  track, trackBackground, layout = 'stacked', density = 'default', interactionMode = 'managed',
  publishIntervalMs, format = current => String(Math.round(current)), resetValue = 0, ...props
}: AdjustmentSliderProps) => {
  const common = { ...props, format, resetValue,
    trackBackground: trackBackground ?? (track ? TRACK_BACKGROUNDS[track] : undefined),
    publishIntervalMs: publishIntervalMs ?? (interactionMode === 'native' ? 0 : 33)
  };
  if (layout === 'bare') return <Slider {...common} />;
  const control = <SliderField {...common}
    layout={layout === 'inline' || layout === 'layer-row' ? 'inline' : 'stacked'}
    size={layout === 'layer-row' || layout === 'tool-bar' || density === 'compact' ? 'small' : 'regular'} />;
  return layout === 'tool-bar' ? <div style={{ width: 148, flexShrink: 0 }}>{control}</div> : control;
};
