import React, { useState } from 'react';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableCommandService } from '../lighttable/application/commands/lightTableCommandService';
import type { LightTableHost } from '../platform/LightTableHost';
import type { LightTableFunnelEvent } from '../platform/LightTableFunnelTelemetry';

export type GuidedSampleStep = 'shape' | 'undo' | 'redo' | 'png' | 'psd' | 'complete';
export interface GuidedSampleSession {
  readonly documentId: DocumentSessionId;
  readonly step: GuidedSampleStep;
  readonly shapeLayerId?: string;
}

const request = (documentId: DocumentSessionId, command: string, parameters: unknown) => ({
  protocolVersion: 1,
  requestId: `guide-${command}-${crypto.randomUUID()}`,
  command,
  documentId,
  parameters
});

const waitForArtifact = (
  service: LightTableCommandService,
  documentId: DocumentSessionId,
  taskId: string
) => new Promise<File>((resolve, reject) => {
  let timeout = 0;
  let poll = 0;
  const finish = () => {
    window.clearTimeout(timeout);
    window.clearTimeout(poll);
  };
  const inspect = () => {
    const task = service.queryTask(documentId, taskId);
    if (!task || task.status === 'running') {
      poll = window.setTimeout(inspect, 16);
      return;
    }
    if (task.status === 'completed' && !task.artifact) {
      poll = window.setTimeout(inspect, 0);
      return;
    }
    finish();
    if (task.status !== 'completed' || !task.artifact) {
      reject(new Error(task.error ?? 'The export did not complete.'));
      return;
    }
    const file = service.resolveArtifact(task.artifact.id);
    if (!file) reject(new Error('The exported artifact is unavailable.'));
    else resolve(file);
  };
  timeout = window.setTimeout(() => {
    finish();
    reject(new Error('The export did not finish within 30 seconds.'));
  }, 30_000);
  inspect();
});

const copyFor = (step: GuidedSampleStep) => ({
  shape: ['Create an editable shape', 'This uses the real vector command and selects the new layer.'],
  undo: ['Undo the edit', 'LightTable keeps one semantic history entry for the shape.'],
  redo: ['Redo the edit', 'Restore the same editable vector layer.'],
  png: ['Quick export PNG', 'Render the document and save a flattened PNG.'],
  psd: ['File → Export → Photoshop PSD', 'Run the layered PSD exporter; unsupported details are reported, never hidden.'],
  complete: ['First edit complete', 'You created, undid, restored and exported a layered document.']
})[step];

export const GuidedSampleCoach: React.FC<{
  readonly session: GuidedSampleSession;
  readonly ready: boolean;
  readonly service: LightTableCommandService;
  readonly host: LightTableHost;
  readonly onSession: (session: GuidedSampleSession) => void;
  readonly onDismiss: () => void;
}> = ({ session, ready, service, host, onSession, onDismiss }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, detail] = copyFor(session.step);
  const record = (event: LightTableFunnelEvent) => host.funnel?.record(event);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      if (session.step === 'shape') {
        const before = service.queryDocument(session.documentId);
        const result = await service.execute(request(session.documentId, 'vector.create', {
          name: 'Guided sample shape',
          primitive: { kind: 'rectangle', x: 230, y: 170, width: 500, height: 300 },
          style: {
            fill: { type: 'solid', color: [0.12, 0.45, 0.95, 1] },
            stroke: {
              paint: { type: 'solid', color: [1, 1, 1, 1] },
              width: 12,
              opacity: 1,
              alignment: 'inside',
              cap: 'butt',
              join: 'round',
              miterLimit: 4,
              dash: [],
              dashOffset: 0
            }
          }
        }));
        const layerId = result.status === 'completed'
          ? (result.value as { layerId?: string }).layerId : undefined;
        const after = service.queryDocument(session.documentId);
        const layer = layerId
          ? service.queryLayers(session.documentId)?.find(({ id }) => id === layerId)
          : undefined;
        if (!layerId || !layer || layer.type !== 'vector'
          || after?.activeLayerId !== layerId || after.layerCount !== (before?.layerCount ?? 0) + 1) {
          throw new Error(`The sample shape was not confirmed in the document model (${JSON.stringify({
            result: result.status,
            reason: result.status === 'rejected' ? result.message : undefined,
            layerId,
            layerType: layer?.type,
            activeLayerId: after?.activeLayerId,
            beforeLayers: before?.layerCount,
            afterLayers: after?.layerCount
          })}).`);
        }
        record('guide.shape-created');
        onSession({ ...session, step: 'undo', shapeLayerId: layerId });
      } else if (session.step === 'undo') {
        await service.execute(request(session.documentId, 'history.undo', {}));
        if (service.queryLayers(session.documentId)?.some(({ id }) => id === session.shapeLayerId)
          || !service.queryDocument(session.documentId)?.history.canRedo) {
          throw new Error('Undo was not confirmed in document history.');
        }
        record('guide.undo-completed'); onSession({ ...session, step: 'redo' });
      } else if (session.step === 'redo') {
        await service.execute(request(session.documentId, 'history.redo', {}));
        if (!service.queryLayers(session.documentId)?.some(({ id }) => id === session.shapeLayerId)) {
          throw new Error('Redo did not restore the sample shape.');
        }
        record('guide.redo-completed'); onSession({ ...session, step: 'png' });
      } else if (session.step === 'png' || session.step === 'psd') {
        const command = session.step === 'png' ? 'file.exportPng' : 'file.exportPsd';
        const result = await service.execute(request(session.documentId, command, {}));
        if (result.status !== 'accepted') throw new Error(result.status === 'rejected' ? result.message : 'Export did not start.');
        const file = await waitForArtifact(service, session.documentId, result.taskId);
        const saved = await host.save({ file, recipe: null });
        if (saved.status !== 'committed') throw new Error(saved.status === 'failed' ? saved.message : 'Export was canceled.');
        if (session.step === 'png') {
          record('guide.png-exported'); onSession({ ...session, step: 'psd' });
        } else {
          record('guide.psd-exported'); record('guide.completed'); onSession({ ...session, step: 'complete' });
        }
      } else {
        onDismiss();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };

  return (
    <aside className="lighttable-guide" aria-label="Guided sample" aria-live="polite">
      <div className="lighttable-guide__heading">
        <span>Guided sample</span>
        <button type="button" aria-label="Dismiss guided sample" onClick={() => { record('guide.dismissed'); onDismiss(); }}>×</button>
      </div>
      <strong>{ready ? title : 'Preparing the sample document...'}</strong>
      <p>{ready ? detail : 'The guide will continue when the real editor and renderer are ready.'}</p>
      <div className="lighttable-guide__progress" aria-label={`Step ${Math.min(6, ['shape', 'undo', 'redo', 'png', 'psd', 'complete'].indexOf(session.step) + 1)} of 6`}>
        {['shape', 'undo', 'redo', 'png', 'psd', 'complete'].map((step) => <i key={step} data-active={step === session.step} />)}
      </div>
      {error ? <p className="lighttable-guide__error" role="alert">{error}</p> : null}
      <button className="action-button" type="button" disabled={!ready || busy} onClick={() => void run()}>
        {busy ? 'Working...' : session.step === 'complete' ? 'Finish' : title}
      </button>
    </aside>
  );
};
