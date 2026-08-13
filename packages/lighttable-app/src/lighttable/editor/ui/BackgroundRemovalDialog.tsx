import React from 'react';
import { ActionButton } from '../../../ui/ActionButton';
import type { BackgroundRemovalControllerState, BackgroundRemovalMaskMode }
  from '../../application/backgroundRemoval/useBackgroundRemovalController';

export const BackgroundRemovalDialog: React.FC<{
  readonly state: BackgroundRemovalControllerState;
  readonly onChoose: (mode: BackgroundRemovalMaskMode) => void;
  readonly onCancel: () => void;
}> = ({ state, onChoose, onCancel }) => {
  if (state.phase === 'idle') return null;
  return (
    <div className="modal-backdrop modal-backdrop--confirm lighttable-dialog-backdrop" role="presentation">
      <section className="modal text-input-dialog text-input-dialog--compact" role="dialog"
        aria-modal="true" aria-labelledby="background-removal-title">
        <header className="modal__header">
          <h2 id="background-removal-title">Remove Background</h2>
        </header>
        <div className="modal__body" aria-live="polite">
          {state.phase === 'running' ? (
            <p>{state.progress.message}{typeof state.progress.percent === 'number'
              ? ` ${Math.round(state.progress.percent)}%` : ''}</p>
          ) : (
            <p>“{state.layerName}” already has a mask. Choose how the generated mask should be applied.</p>
          )}
        </div>
        <footer className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          {state.phase === 'choose-mask-mode' && <>
            <ActionButton onClick={() => onChoose('new-layer')}>New masked layer</ActionButton>
            <ActionButton onClick={() => onChoose('intersect')}>Intersect</ActionButton>
            <ActionButton onClick={() => onChoose('replace')}>Replace</ActionButton>
          </>}
        </footer>
      </section>
    </div>
  );
};
