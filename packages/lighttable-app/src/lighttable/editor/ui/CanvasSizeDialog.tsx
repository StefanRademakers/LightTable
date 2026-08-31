import { Button } from '@lighttable/ui';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AnchorGridControl } from '../../../ui/AnchorGridControl';
import { NumberField } from '@lighttable/ui';
import { SwitchControl } from '@lighttable/ui';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import type { ImageDocument } from '../document/documentTypes';
import {
  MAX_DOCUMENT_GEOMETRY_DIMENSION,
  type CanvasAnchor,
  type DocumentGeometryRequest
} from '../../application/documentGeometry/documentGeometryModel';

export interface CanvasSizeDialogProps {
  readonly open: boolean;
  readonly document: ImageDocument | null;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (request: DocumentGeometryRequest) => void;
}

export const CanvasSizeDialog = ({ open, document, busy = false, onCancel, onCommit }: CanvasSizeDialogProps) => {
  const [width, setWidth] = useState(1);
  const [height, setHeight] = useState(1);
  const [relative, setRelative] = useState(false);
  const [anchorX, setAnchorX] = useState<CanvasAnchor>(0.5);
  const [anchorY, setAnchorY] = useState<CanvasAnchor>(0.5);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useLayoutEffect(() => {
    if (!open || !document) return;
    setWidth(document.width); setHeight(document.height); setRelative(false);
    setAnchorX(0.5); setAnchorY(0.5);
  }, [document, open]);

  if (!open || !document) return null;
  const targetWidth = Math.round(relative ? document.width + width : width);
  const targetHeight = Math.round(relative ? document.height + height : height);
  const valid = targetWidth >= 1 && targetHeight >= 1
    && targetWidth <= MAX_DOCUMENT_GEOMETRY_DIMENSION
    && targetHeight <= MAX_DOCUMENT_GEOMETRY_DIMENSION;
  const setRelativeMode = (next: boolean) => {
    setRelative(next);
    setWidth(next ? 0 : document.width);
    setHeight(next ? 0 : document.height);
  };

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onCancel}>
      <form ref={dialogRef} className="modal canvas-size-dialog" role="dialog" aria-modal="true"
        aria-label="Canvas Size" tabIndex={-1} data-editor-native-tab-navigation
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || busy) return;
          onCommit({ operation: 'canvas-size', width: targetWidth, height: targetHeight, anchorX, anchorY });
        }}>
        <div className="modal__header"><h3 className="modal__title">Canvas Size</h3></div>
        <div className="canvas-size-dialog__current">
          <span>Current Size</span><strong>{document.width} × {document.height} px</strong>
        </div>
        <div className="canvas-size-dialog__fields">
          <label><span>{relative ? 'Width change' : 'Width'}</span>
            <NumberField tabIndex={0} value={width} kind="integer" step={1}
              onValueChange={(value) => Number.isFinite(value) && setWidth(value)} /></label>
          <span className="canvas-size-dialog__unit">Pixels</span>
          <label><span>{relative ? 'Height change' : 'Height'}</span>
            <NumberField tabIndex={0} value={height} kind="integer" step={1}
              onValueChange={(value) => Number.isFinite(value) && setHeight(value)} /></label>
          <span className="canvas-size-dialog__unit">Pixels</span>
        </div>
        <div className="canvas-size-dialog__relative">
          <span>Relative</span>
          <SwitchControl checked={relative} onCheckedChange={setRelativeMode} label="Use relative canvas dimensions" />
        </div>
        <div className="canvas-size-dialog__anchor">
          <span>Anchor</span>
          <AnchorGridControl x={anchorX} y={anchorY} onChange={(x, y) => { setAnchorX(x); setAnchorY(y); }} />
        </div>
        {!valid ? <p className="lighttable-preferences__error">Resulting dimensions must be 1–{MAX_DOCUMENT_GEOMETRY_DIMENSION} pixels.</p> : null}
        <div className="modal__footer">
          <Button tabIndex={0} onClick={onCancel}>Cancel</Button>
          <Button tabIndex={0} type="submit" disabled={!valid || busy}>{busy ? 'Applying…' : 'OK'}</Button>
        </div>
      </form>
    </div>,
    globalThis.document.body
  );
};
