import React from 'react';
import type { GenAiAssetId, GenAiGenerationJob } from '@lighttable/genai-core';
import { ActionButton } from '../../ui/ActionButton';

export interface AiHistoryPanelProps {
  readonly jobs: readonly GenAiGenerationJob[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly previews?: Readonly<Record<string, string>>;
  readonly onRequestPreview?: (assetId: GenAiAssetId) => void;
  readonly onOpenResult?: (job: GenAiGenerationJob) => void;
  readonly onRestoreSetup?: (job: GenAiGenerationJob) => void;
  readonly onStopTracking?: (job: GenAiGenerationJob) => Promise<void> | void;
  readonly onResumeTracking?: (job: GenAiGenerationJob) => Promise<void> | void;
}

const jobStatusLabel: Record<GenAiGenerationJob['status'], string> = {
  queued: 'Queued',
  submitting: 'Submitting',
  running: 'Generating',
  succeeded: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  'unknown-submit': 'Checking status'
};

/**
 * Provider-neutral queue and generation history. The job owner lives outside
 * React so closing this panel never interrupts work or loses history.
 */
export const AiHistoryPanel = ({ jobs, loading = false, error, previews = {}, onRequestPreview,
  onOpenResult, onRestoreSetup, onStopTracking, onResumeTracking }: AiHistoryPanelProps) => {
  const [actionError, setActionError] = React.useState<string>();
  const [busyJob, setBusyJob] = React.useState<string>();
  const runAction = (job: GenAiGenerationJob, action: ((job: GenAiGenerationJob) => Promise<void> | void) | undefined) => {
    if (!action) return;
    setBusyJob(job.id); setActionError(undefined);
    void Promise.resolve(action(job)).catch((reason) => {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setBusyJob(undefined));
  };
  React.useEffect(() => {
    for (const job of jobs) {
      for (const result of job.results) onRequestPreview?.(result.assetId);
    }
  }, [jobs, onRequestPreview]);
  const activeJobs = jobs.filter(({ status }) => status !== 'succeeded');
  const completedJobs = jobs.filter(({ status }) => status === 'succeeded');
  const renderActions = (job: GenAiGenerationJob) => {
    const result = job.results[0];
    return <div className="genai-history__actions">
      {result ? <ActionButton onClick={() => onOpenResult?.(job)} disabled={!onOpenResult}>Open</ActionButton> : null}
      <ActionButton onClick={() => onRestoreSetup?.(job)} disabled={!onRestoreSetup}>Use settings</ActionButton>
      {(job.status === 'running' || job.status === 'unknown-submit')
        ? <ActionButton onClick={() => runAction(job, onStopTracking)}
          disabled={!onStopTracking || busyJob === job.id}>Stop tracking</ActionButton> : null}
      {(job.status === 'cancelled' || job.status === 'failed') && job.providerJobId
        ? <ActionButton onClick={() => runAction(job, onResumeTracking)}
          disabled={!onResumeTracking || busyJob === job.id}>Resume tracking</ActionButton> : null}
    </div>;
  };
  return <aside className="lighttable-panel" aria-label="AI history">
    <div className="lighttable-panel__controls">
      {error || actionError ? <div className="lighttable-panel__error">{actionError ?? error}</div> : null}
      {loading && jobs.length === 0 ? (
        <div className="lighttable-panel__empty">Loading generation history…</div>
      ) : jobs.length === 0 ? (
        <div className="lighttable-panel__empty">
          Generated images and active jobs will appear here.
        </div>
      ) : <>
        {activeJobs.length ? <section className="genai-history__queue" aria-label="Generation queue">
          <h3>Queue</h3>{activeJobs.map((job) => <article key={job.id} className="lighttable-panel__section genai-history__job">
            <strong>{job.request.prompt || 'Untitled generation'}</strong>
            <span>{jobStatusLabel[job.status]}</span>
            {job.error ? <span className="lighttable-panel__error">{job.error}</span> : null}
            {renderActions(job)}
          </article>)}
        </section> : null}
        {completedJobs.length ? <section className="genai-history__history" aria-label="Generation history">
          <h3>History</h3><div className="genai-history__grid">{completedJobs.map((job) => {
            const result = job.results[0];
            return <article key={job.id} className="genai-history__card">
              <div className="genai-history__preview">
                {result && previews[result.assetId]
                  ? <img className="genai-history__thumbnail" src={previews[result.assetId]} alt="" />
                  : <span>Image</span>}
              </div>
              <strong title={job.request.prompt}>{job.request.prompt || 'Untitled generation'}</strong>
              {result?.fileName ? <small title={result.fileName}>{result.fileName}</small> : null}
              {renderActions(job)}
            </article>;
          })}</div>
        </section> : null}
      </>}
    </div>
  </aside>;
};
