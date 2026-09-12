import { useCallback, useRef } from 'react';

/** Adds concrete session identity to the shared mounted renderer/workspace scope. */
export const useFaceWarpScope = (session: { isAcceptingMutations(): boolean } | undefined,
  captureMountedScope: () => { isCurrent(): boolean }
) => {
  const latest = useRef({ session, captureMountedScope });
  latest.current = { session, captureMountedScope };
  return useCallback(() => {
    const openingSession = latest.current.session;
    const scope = latest.current.captureMountedScope();
    return { isCurrent: () => latest.current.session === openingSession
      && (!openingSession || openingSession.isAcceptingMutations()) && scope.isCurrent() };
  }, []);
};
