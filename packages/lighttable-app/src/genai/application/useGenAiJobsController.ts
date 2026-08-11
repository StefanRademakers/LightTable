import React from 'react';
import type { GenAiGenerationJob } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { GenAiEditorDeliveryTracker } from './generationDelivery';

export interface GenAiJobsSnapshot {
  readonly jobs: readonly GenAiGenerationJob[];
  readonly loading: boolean;
  readonly error?: string;
}

const newestFirst = (jobs: readonly GenAiGenerationJob[]) =>
  [...jobs].sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);

const upsertJob = (
  jobs: readonly GenAiGenerationJob[],
  job: GenAiGenerationJob
): readonly GenAiGenerationJob[] => newestFirst([
  ...jobs.filter((candidate) => candidate.id !== job.id),
  job
]);

/**
 * Project-scoped projection of the durable desktop generation journal.
 * Provider polling and file writes remain outside React; the UI only consumes
 * the initial snapshot and compact job-change publications.
 */
export const useGenAiJobsController = (
  service: LightTableGenAiService | undefined,
  projectId?: string,
  onSucceeded?: (job: GenAiGenerationJob) => void,
  refreshKey?: unknown
): GenAiJobsSnapshot => {
  const [jobs, setJobs] = React.useState<readonly GenAiGenerationJob[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const deliveryTracker = React.useRef(new GenAiEditorDeliveryTracker());
  const onSucceededRef = React.useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;
  deliveryTracker.current.selectProject(projectId);

  React.useEffect(() => {
    if (!service || !projectId) {
      setJobs([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    let active = true;
    setJobs([]);
    setLoading(true);
    setError(undefined);
    const unsubscribe = service.subscribeJobs(projectId, (job) => {
      if (!active) return;
      setJobs((current) => upsertJob(current, job));
      if (deliveryTracker.current.claim(job)) onSucceededRef.current?.(job);
    });
    void service.listJobs(projectId).then((snapshot) => {
      if (active) {
        deliveryTracker.current.rememberExisting(snapshot);
        setJobs(newestFirst(snapshot));
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId, refreshKey, service]);

  return { jobs, loading, error };
};
