import React from 'react';
import { ActionButton } from '../../../../ui/ActionButton';
import { AdjustmentSlider } from '../../../AdjustmentSlider';
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
  readonly meshVisible: boolean;
  readonly brushSize: number;
  readonly brushStrength: number;
  readonly semanticTarget: FaceWarpSemanticTarget;
  readonly protectedFeature: FaceWarpProtectedFeature;
  readonly onDetect: () => void;
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
}

const SemanticSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}> = ({ label, value, onChange, onInteractionStart, onInteractionEnd }) => <AdjustmentSlider
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
  meshVisible,
  brushSize,
  brushStrength,
  semanticTarget,
  protectedFeature,
  onDetect,
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
  const selected = faces.find((face) => face.id === selectedFaceId) ?? faces[0] ?? null;
  const featureValue = (key: 'eyeSize' | 'smile') => selected
    ? semanticTarget === 'both'
      ? selected.parameters[key]
      : selected.featureOverrides?.[semanticTarget]?.[key] ?? selected.parameters[key]
    : 0;
  return <>
    <ActionButton disabled={busy} onClick={onDetect}>
      {busy ? 'Detecting faces…' : faces.length > 0 ? 'Redetect faces' : 'Detect faces'}
    </ActionButton>
    {faces.length > 0 ? <label className="lighttable-tool-options__field">
      <span>Face</span>
      <select value={selected?.id ?? ''} onChange={(event) => onSelectFace(event.currentTarget.value)}>
        {faces.map((face, index) => <option key={face.id} value={face.id}>Face {index + 1}</option>)}
      </select>
    </label> : null}
    <label className="lighttable-tool-options__toggle">
      <input type="checkbox" checked={meshVisible}
        disabled={faces.length === 0}
        onChange={(event) => onMeshVisibleChange(event.currentTarget.checked)} />
      Show mesh
    </label>
    {selected ? <>
      <AdjustmentSlider label="Brush" value={brushSize} min={8} max={1200}
        resetValue={120} format={(current) => `${Math.round(current)} px`}
        onReset={() => onBrushChange({ size: 120 })}
        onChange={(size) => onBrushChange({ size })} />
      <AdjustmentSlider label="Strength" value={brushStrength * 100} min={1} max={100}
        resetValue={35} format={(current) => `${Math.round(current)}%`}
        onReset={() => onBrushChange({ strength: 0.35 })}
        onChange={(strength) => onBrushChange({ strength: strength / 100 })} />
      <span className="lighttable-tool-options__hint">Drag to sculpt · Shift-drag to relax · Alt-drag to restore</span>
      <label className="lighttable-tool-options__field">
        <span>Target</span>
        <select value={semanticTarget}
          onChange={(event) => onSemanticTargetChange(event.currentTarget.value as FaceWarpSemanticTarget)}>
          <option value="both">Both sides</option>
          <option value="left">Left side</option>
          <option value="right">Right side</option>
        </select>
      </label>
      <label className="lighttable-tool-options__field">
        <span>Protect</span>
        <select value={protectedFeature}
          onChange={(event) => onProtectedFeatureChange(
            event.currentTarget.value as FaceWarpProtectedFeature
          )}>
          <option value="eyes">Eyes</option>
          <option value="lips">Lips</option>
          <option value="nose">Nose</option>
          <option value="face-outline">Face outline</option>
        </select>
      </label>
      <label className="lighttable-tool-options__toggle">
        <input type="checkbox" checked={selected.protection?.[protectedFeature] === true}
          onChange={(event) => onProtectionChange(protectedFeature, event.currentTarget.checked)} />
        Locked
      </label>
      <SemanticSlider label="Face" value={selected.parameters.faceWidth}
        onChange={(faceWidth) => onParametersChange({ faceWidth })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} />
      <SemanticSlider label="Eyes" value={featureValue('eyeSize')}
        onChange={(eyeSize) => onParametersChange({ eyeSize })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} />
      <SemanticSlider label="Nose" value={selected.parameters.noseWidth}
        onChange={(noseWidth) => onParametersChange({ noseWidth })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} />
      <SemanticSlider label="Smile" value={featureValue('smile')}
        onChange={(smile) => onParametersChange({ smile })}
        onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd} />
      <ActionButton size="compact" onClick={onReset}>Reset face</ActionButton>
    </> : null}
  </>;
};
