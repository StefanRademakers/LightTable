import { useMemo, useSyncExternalStore } from 'react';
import type { LightTableCommandService } from './lightTableCommandService';

const subscribeNone = () => () => undefined;
const zero = () => 0;

export const useAgentActivity = (service: LightTableCommandService | undefined, documentId: string) => {
  const revision = useSyncExternalStore(service?.subscribeTaskEvents ?? subscribeNone,
    service?.taskEventRevision ?? zero, zero);
  return useMemo(() => service?.queryTaskEvents(0, 200).events
    .filter(({ taskId }) => taskId.startsWith(`${documentId}:`)) ?? [],
  [revision, service, documentId]);
};
