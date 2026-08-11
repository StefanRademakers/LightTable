import type { GenAiGenerationJob } from '@lighttable/genai-core';

/**
 * Prevents a terminal job publication from placing the same paid result more
 * than once during an editor session. Existing journal entries are history,
 * not implicit editor commands; users can explicitly open those again.
 */
export class GenAiEditorDeliveryTracker {
  private projectId?: string;
  private readonly delivered = new Set<string>();

  selectProject(projectId?: string): void {
    if (projectId === this.projectId) return;
    this.projectId = projectId;
    this.delivered.clear();
  }

  rememberExisting(jobs: readonly GenAiGenerationJob[]): void {
    for (const job of jobs) {
      if (job.status === 'succeeded' && job.results.length > 0) this.delivered.add(job.id);
    }
  }

  claim(job: GenAiGenerationJob): boolean {
    if (job.status !== 'succeeded' || job.results.length === 0 || this.delivered.has(job.id)) return false;
    this.delivered.add(job.id);
    return true;
  }
}
