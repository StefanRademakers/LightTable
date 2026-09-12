import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LightTableEditorOverlay } from '../../packages/lighttable-app/src/lighttable/LightTableEditorOverlay';
import { WorkspaceSession } from '../../packages/lighttable-app/src/lighttable/application/workspace/workspaceSession';
import { EditorApplicationSession } from '../../packages/lighttable-app/src/lighttable/application/workspace/editorApplicationSession';
import { DocumentTaskRegistry } from '../../packages/lighttable-app/src/lighttable/application/tasks/documentTaskRegistry';
import { LightTableCommandService } from '../../packages/lighttable-app/src/lighttable/application/commands/lightTableCommandService';
import { LightTableCommandPortRegistry } from '../../packages/lighttable-app/src/lighttable/application/commands/lightTableCommandPortRegistry';
import type { DocumentSessionId } from '../../packages/lighttable-app/src/lighttable/application/documents/documentSession';
import '../../packages/lighttable-app/src/lighttable/lighttable.css';

// Public host contract, not private React/kernel state injection. A non-image
// host surface isolates presentation open/close from image decoding and WebGPU.
const workspace = new WorkspaceSession();
const commandPorts = new LightTableCommandPortRegistry();
const commandService = new LightTableCommandService(workspace, commandPorts);
const tasks = new DocumentTaskRegistry('open-host' as DocumentSessionId);
const applicationEditorSession = new EditorApplicationSession();
function Host() {
  const [open, setOpen] = useState(false);
  return <>
    <button style={{ position: 'fixed', zIndex: 100000, top: 5, left: 500 }}
      onClick={() => setOpen(value => !value)}>{open ? 'Close presentation' : 'Open presentation'}</button>
    <LightTableEditorOverlay open={open} projectId="" workspaceDocumentId="open-host"
      workspaceDocumentKind="video" documentSurfaceOverride={<div data-testid="host-surface">Public host surface</div>}
      fileNameBase="Host" subjectLabel="Host" onClose={() => setOpen(false)}
      onSave={() => ({ status: 'canceled' })} tasks={tasks} commandService={commandService}
      commandPorts={commandPorts} applicationEditorSession={applicationEditorSession} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Host />);
