import { Button, Dialog, Text } from '@lighttable/ui';
import React from 'react';

import type { BackgroundRemovalControllerState, BackgroundRemovalMaskMode }
  from '../../application/backgroundRemoval/useBackgroundRemovalController';

export const BackgroundRemovalDialog: React.FC<{
  readonly state: BackgroundRemovalControllerState;
  readonly onChoose: (mode: BackgroundRemovalMaskMode) => void;
  readonly onCancel: () => void;
}> = ({ state, onChoose, onCancel }) => {
  if (state.phase === 'idle') return null;
  return (
    <Dialog open title="Remove Background" onDismiss={onCancel} footer={<>
      <Button tabIndex={0} onClick={onCancel}>Cancel</Button>
      {state.phase === 'choose-mask-mode' && <>
        <Button tabIndex={0} onClick={() => onChoose('new-layer')}>New masked layer</Button>
        <Button tabIndex={0} onClick={() => onChoose('intersect')}>Intersect</Button>
        <Button tabIndex={0} onClick={() => onChoose('replace')}>Replace</Button>
      </>}
    </>}>
        <div aria-live="polite">
          {state.phase === 'running' ? (
            <Text as="p">{state.progress.message}{typeof state.progress.percent === 'number'
              ? ` ${Math.round(state.progress.percent)}%` : ''}</Text>
          ) : (
            <Text as="p">“{state.layerName}” already has a mask. Choose how the generated mask should be applied.</Text>
          )}
        </div>
    </Dialog>
  );
};
