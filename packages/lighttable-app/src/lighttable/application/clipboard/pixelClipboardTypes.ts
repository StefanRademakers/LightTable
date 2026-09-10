import type { LayerId, Rect } from '../../editor/document/documentTypes';
import type { PaintChannel } from '../../editor/session/editorSession';

export interface PixelClipboardCapture {
  readonly file: File;
  readonly bounds: Rect;
  readonly fastPasteToken?: string;
}

export interface PixelClipboardPlacement extends Rect {
  readonly name?: string;
  readonly target?: { readonly channel: PaintChannel; readonly layerId?: LayerId };
}

export interface PixelClipboardPasteResult {
  readonly layerId: LayerId;
  readonly width: number;
  readonly height: number;
}
