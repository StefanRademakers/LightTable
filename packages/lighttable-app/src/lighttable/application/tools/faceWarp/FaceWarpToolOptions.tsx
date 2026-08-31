import { Checkbox, Button, SegmentedControl } from '@lighttable/ui';
import React, { useState } from 'react';


import { AdjustmentSlider, type AdjustmentSliderProps } from '../../../../ui/AdjustmentSlider';
import { Select } from '@lighttable/ui';
import type {
  FaceWarpFace,
  FaceWarpFeatureSide,
  FaceWarpParameters,
  FaceWarpProtectedFeature
} from '../../../effects/faceWarp/faceWarpTypes';

export type FaceWarpSemanticTarget = 'both' | FaceWarpFeatureSide;

export interface FaceWarpToolOptionsProps {
  readonly faces: readonly FaceWarpFace[];
  readonly selectedFaceId: string | null;
  readonly busy: boolean;
  readonly reviewPending: boolean;
  readonly meshVisible: boolean;
  readonly brushSize: number;
  readonly brushStrength: number;
  readonly semanticTarget: FaceWarpSemanticTarget;
  readonly protectedFeature: FaceWarpProtectedFeature;
  readonly onDetect: () => void;
  readonly onAcceptDetection: () => void;
  readonly onCancelDetection: () => void;
  readonly onSelectFace: (faceId: string) => void;
  readonly onMeshVisibleChange: (visible: boolean) => void;
  readonly onBrushChange: (change: { size?: number; strength?: number }) => void;
  readonly onSemanticTargetChange: (target: FaceWarpSemanticTarget) => void;
  readonly onProtectedFeatureChange: (feature: FaceWarpProtectedFeature) => void;
  readonly onProtectionChange: (feature: FaceWarpProtectedFeature, locked: boolean) => void;
  readonly onParametersChange: (change: Partial<FaceWarpParameters>) => void;
  readonly onInteractionStart: () => void;
  readonly onInteractionEnd: () => void;
  readonly onReset: () => void;
  readonly adjustmentLayout?: AdjustmentSliderProps['layout'];
}

const SemanticSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  layout?: AdjustmentSliderProps['layout'];
}> = ({ label, value, onChange, onInteractionStart, onInteractionEnd, layout }) => <AdjustmentSlider
  layout={layout}
  label={label}
  value={value * 100}
  min={-100}
  max={100}
  resetValue={0}
  format={(current) => `${Math.round(current)}%`}
  onReset={() => onChange(0)}
  onChange={(current) => onChange(current / 100)}
  onInteractionStart={onInteractionStart}
  onInteractionEnd={onInteractionEnd}
/>;

export const FaceWarpToolOptions: React.FC<FaceWarpToolOptionsProps> = ({
  faces,
  selectedFaceId,
  busy,
  reviewPending,
  meshVisible,
  brushSize,
  brushStrength,
  semanticTarget,
  protectedFeature,
  adjustmentLayout,
  onDetect,
  onAcceptDetection,
  onCancelDetection,
  onSelectFace,
  onMeshVisibleChange,
  onBrushChange,
  onSemanticTargetChange,
  onProtectedFeatureChange,
  onProtectionChange,
  onParametersChange,
  onInteractionStart,
  onInteractionEnd,
  onReset
}) => {
  const [mode, setMode] = useState<'sculpt' | 'adjust'>('sculpt');
  const [semanticFeature, setSemanticFeature] = useState<'face' | 'eyes' | 'nose' | 'smile'>('face');
  const selected = faces.find((face) => face.id === selectedFaceId) ?? faces[0] ?? null;
  const featureValue = (key: 'eyeSize' | 'smile') => selected
    ? semanticTarget === 'both'
      ? selected.parameters[key]
      : selected.featureOverrides?.[semanticTarget]?.[key] ?? selected.parameters[key]
    : 0;
  return <>
    {reviewPending ? <>
      <span className="lighttable-tool-options__hint">Check that the mesh follows the face.</span>
      <Button onClick={onAcceptDetection}>Accept mesh</Button>
      <Button onClick={onCancelDetection}>Cancel</Button>
    </> : <Button disabled={busy} onClick={onDetect}>
      {busy ? 'Detecting faces…' : faces.length > 0 ? 'Redetect faces' : 'Detect faces'}
    </Button>}
    {faces.length > 0 && !reviewPending ? <SegmentedControl value={mode} onChange={setMode}
      label="Face Warp editing mode" options={[
        { value: 'sculpt', label: 'Sculpt' },
        { value: 'adjust', label: 'Adjust' }
      ]} /> : null}
    {faces.length > 0 && !reviewPending ? <label className="lighttable-tool-options__field">
      <span>Face</span>
      <Select value={selected?.id ?? ''} onValueChange={(nextValue) => onSelectFace(nextValue)}>
        {faces.map((face, index) => <option key={face.id} value={face.id}>Face {index + 1}</option>)}
      </Select>
    </label> : null}
    <label className="lighttable-tool-options__toggle">
      <Checkbox  checked={meshVisible}
        disabled={faces.length === 0 || reviewPending}
        onChange={(event) => onMeshVisibleChange(event.currentTarget.checked)} />
      Show mesh
    </label>
    {selected && !reviewPending && mode === 'sculpt' ? <>
      <AdjustmentSlider layout={adjustmentLayout} label="Brush" value={brushSize} min={8} max={1200}
        resetValue={120} format={(current) => `${Math.round(current)} px`}
        onReset={() => onBrushChange({ size: 120 })}
        onChange={(size) => onBrushChange({ size })} />
      <AdjustmentSlider layout={adjustmentLayout} label="Strength" value={brushStrength * 100} min={1} max={100}
        resetValue={35} format={(current) => `${Math.round(current)}%`}
        onReset={() => onBrushChange({ strength: 0.35 })}
        onChange={(strength) => onBrushChange({ strength: strength / 100 })} />
      <span className="lighttable-tool-options__hint">Drag to sculpt · Shift-drag to relax · Alt-drag to restore</span>
    </> : null}
    {selected && !reviewPending && mode === 'adjust' ? <>
      <label className="lighttable-tool-options__field">
        <span>Target</span>
        <Select value={semanticTarget}
          onValueChange={(nextValue) => onSemanticTargetChange(nextValue as FaceWarpSemanticTarget)}>
          <option value="both">Both sides</option>
          <option value="left">Left side</option>
          <option value="right">Right side</option>
        </Select>
      </label>
      <label className="lighttable-tool-options__field">
        <span>Protect</span>
        <Select value={protectedFeature}
          onValueChange={(nextValue) => onProtectedFeatureChange(
            nextValue as FaceWarpProtectedFeature
          )}>
          <option value="eyes">Eyes</option>
          <option value="lips">Lips</option>
          <option value="nose">Nose</option>
          <option value="face-outline">Face outline</option>
        </Select>
      </label>
      <label className="lighttable-tool-options__toggle">
        <Checkbox  checked={selected.protection?.[protectedFeature] === true}
          onChange={(event) => onProtectionChange(protectedFeature, event.currentTarget.checked)} />
        Locked
      </label>
      <label className="lighttable-tool-options__field">
        <span>Feature</span>
        <Select value={semanticFeature}
          onValueChange={(nextValue) => setSemanticFeature(
            nextValue as typeof semanticFeature
          )}>
          <option value="face">Face width</option>
          <option value="eyes">Eye size</option>
          <option value="nose">Nose width</option>
          <option value="smile">Smile</option>
        </Select>
      </label>
      {semanticFeature === 'face' ? <SemanticSlider layout={adjustmentLayout} label="Amount"
        value={selected.parameters.faceWidth}
        onChange={(faceWidth) => onParametersChange({ faceWidth })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} /> : null}
      {semanticFeature === 'eyes' ? <SemanticSlider layout={adjustmentLayout} label="Amount" value={featureValue('eyeSize')}
        onChange={(eyeSize) => onParametersChange({ eyeSize })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} /> : null}
      {semanticFeature === 'nose' ? <SemanticSlider layout={adjustmentLayout} label="Amount"
        value={selected.parameters.noseWidth}
        onChange={(noseWidth) => onParametersChange({ noseWidth })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} /> : null}
      {semanticFeature === 'smile' ? <SemanticSlider layout={adjustmentLayout} label="Amount" value={featureValue('smile')}
        onChange={(smile) => onParametersChange({ smile })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} /> : null}
    </> : null}
    {selected && !reviewPending ? <Button onClick={onReset}>Reset face</Button> : null}
  </>;
};
