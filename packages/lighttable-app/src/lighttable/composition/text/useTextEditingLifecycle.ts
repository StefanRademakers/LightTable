import { useEffect, useLayoutEffect } from 'react';
import type { LayerId } from '../../editor/document/documentTypes';

interface TextEditingLifecycleController {
  finish(): unknown;
  reset(): void;
}

interface TextPropertyLifecycleController {
  cancel(): void;
  dispose(): void;
  finishIfEditingLayerChanged(layerId: LayerId | null): void;
}

/** Owns text editing/property retirement across document and layer changes. */
export const useTextEditingLifecycle = ({
  documentId,
  activeLayerId,
  editingLayerId,
  editingStatus,
  editing,
  properties
}: {
  readonly documentId: string;
  readonly activeLayerId: LayerId | null;
  readonly editingLayerId: LayerId | null;
  readonly editingStatus: string;
  readonly editing: TextEditingLifecycleController;
  readonly properties: TextPropertyLifecycleController;
}): void => {
  useEffect(() => () => {
    editing.finish();
    properties.dispose();
    editing.reset();
  }, [editing, properties]);

  useLayoutEffect(() => {
    properties.cancel();
    editing.reset();
  }, [documentId, editing, properties]);

  useEffect(() => {
    properties.finishIfEditingLayerChanged(activeLayerId);
  }, [activeLayerId, editingLayerId, editingStatus, properties]);
};
